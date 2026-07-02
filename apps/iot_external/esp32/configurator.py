from __future__ import annotations

import json
import queue
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import serial
from serial.tools import list_ports


APP_TITLE = "ESP32 Configurator"
DEFAULT_CONFIG = {
    "deviceId": "esp32-room-01",
    "wifi": {
        "ssid": "",
        "password": "",
    },
    "transport": {
        "type": "mqtt_ws",
        "brokerUrl": "ws://172.16.22.140:1886",
        "telemetryTopic": "iot_proj/sensors",
        "commandTopic": "iot_proj/actions",
    },
    "sampling": {
        "telemetryIntervalMs": 5000,
    },
}
DEFAULT_BAUDRATE = "115200"
SERIAL_TIMEOUT_SECONDS = 3.0


class ConfiguratorApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title(APP_TITLE)
        self.root.minsize(980, 700)
        self.root.configure(bg="#f3efe7")

        self._send_thread: threading.Thread | None = None
        self._event_queue: queue.Queue[tuple[str, str]] = queue.Queue()

        self.port_var = tk.StringVar()
        self.baudrate_var = tk.StringVar(value=DEFAULT_BAUDRATE)
        self.device_id_var = tk.StringVar(value=DEFAULT_CONFIG["deviceId"])
        self.wifi_ssid_var = tk.StringVar(value=DEFAULT_CONFIG["wifi"]["ssid"])
        self.wifi_password_var = tk.StringVar(value=DEFAULT_CONFIG["wifi"]["password"])
        self.transport_type_var = tk.StringVar(value=DEFAULT_CONFIG["transport"]["type"])
        self.broker_url_var = tk.StringVar(value=DEFAULT_CONFIG["transport"]["brokerUrl"])
        self.telemetry_topic_var = tk.StringVar(value=DEFAULT_CONFIG["transport"]["telemetryTopic"])
        self.command_topic_var = tk.StringVar(value=DEFAULT_CONFIG["transport"]["commandTopic"])
        self.interval_var = tk.StringVar(
            value=str(DEFAULT_CONFIG["sampling"]["telemetryIntervalMs"])
        )

        self._tracked_vars = [
            self.port_var,
            self.baudrate_var,
            self.device_id_var,
            self.wifi_ssid_var,
            self.wifi_password_var,
            self.transport_type_var,
            self.broker_url_var,
            self.telemetry_topic_var,
            self.command_topic_var,
            self.interval_var,
        ]

        self._build_ui()
        self._bind_updates()
        self.refresh_ports()
        self.update_preview()
        self.root.after(150, self._drain_events)

    def _build_ui(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure("Panel.TFrame", background="#fffaf3")
        style.configure("Header.TLabel", background="#fffaf3", foreground="#1d2939", font=("Segoe UI Semibold", 18))
        style.configure("Section.TLabel", background="#fffaf3", foreground="#475467", font=("Segoe UI Semibold", 10))
        style.configure("Body.TLabel", background="#fffaf3", foreground="#344054", font=("Segoe UI", 10))
        style.configure("Primary.TButton", font=("Segoe UI Semibold", 10))

        container = ttk.Frame(self.root, style="Panel.TFrame", padding=20)
        container.pack(fill="both", expand=True)
        container.columnconfigure(0, weight=11)
        container.columnconfigure(1, weight=9)
        container.rowconfigure(0, weight=1)

        left = ttk.Frame(container, style="Panel.TFrame", padding=(0, 0, 18, 0))
        left.grid(row=0, column=0, sticky="nsew")
        left.columnconfigure(1, weight=1)

        right = ttk.Frame(container, style="Panel.TFrame")
        right.grid(row=0, column=1, sticky="nsew")
        right.rowconfigure(1, weight=1)
        right.rowconfigure(3, weight=1)

        ttk.Label(left, text="Настройка ESP32 по USB", style="Header.TLabel").grid(
            row=0, column=0, columnspan=2, sticky="w"
        )
        ttk.Label(
            left,
            text="Подключите плату кабелем, укажите параметры сети и отправьте конфигурацию в устройство.",
            style="Body.TLabel",
            wraplength=520,
            justify="left",
        ).grid(row=1, column=0, columnspan=2, sticky="w", pady=(8, 18))

        row = 2
        ttk.Label(left, text="Подключение", style="Section.TLabel").grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 8)
        )
        row += 1

        port_values = ttk.Frame(left, style="Panel.TFrame")
        port_values.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(0, 14))
        port_values.columnconfigure(1, weight=1)

        ttk.Label(port_values, text="COM-порт", style="Body.TLabel").grid(row=0, column=0, sticky="w", padx=(0, 12))
        self.port_combo = ttk.Combobox(
            port_values,
            textvariable=self.port_var,
            state="readonly",
            width=24,
        )
        self.port_combo.grid(row=0, column=1, sticky="ew")
        ttk.Button(port_values, text="Обновить", command=self.refresh_ports).grid(
            row=0, column=2, sticky="e", padx=(12, 0)
        )

        ttk.Label(port_values, text="Скорость", style="Body.TLabel").grid(row=1, column=0, sticky="w", padx=(0, 12), pady=(12, 0))
        ttk.Entry(port_values, textvariable=self.baudrate_var).grid(row=1, column=1, sticky="ew", pady=(12, 0))

        row += 1
        ttk.Label(left, text="Параметры устройства", style="Section.TLabel").grid(
            row=row, column=0, columnspan=2, sticky="w", pady=(0, 8)
        )
        row += 1
        row = self._add_labeled_entry(left, row, "Device ID", self.device_id_var)
        row = self._add_labeled_entry(left, row, "Wi-Fi SSID", self.wifi_ssid_var)
        row = self._add_labeled_entry(left, row, "Wi-Fi пароль", self.wifi_password_var, show="*")
        row = self._add_labeled_entry(left, row, "Transport type", self.transport_type_var)
        row = self._add_labeled_entry(left, row, "Broker URL", self.broker_url_var)
        row = self._add_labeled_entry(left, row, "Telemetry topic", self.telemetry_topic_var)
        row = self._add_labeled_entry(left, row, "Command topic", self.command_topic_var)
        row = self._add_labeled_entry(left, row, "Интервал телеметрии, мс", self.interval_var)

        actions = ttk.Frame(left, style="Panel.TFrame")
        actions.grid(row=row, column=0, columnspan=2, sticky="ew", pady=(18, 0))
        actions.columnconfigure(0, weight=1)
        actions.columnconfigure(1, weight=1)
        actions.columnconfigure(2, weight=1)

        self.send_button = ttk.Button(actions, text="Отправить в устройство", command=self.send_to_device, style="Primary.TButton")
        self.send_button.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        ttk.Button(actions, text="Сохранить JSON", command=self.save_config).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(actions, text="Загрузить JSON", command=self.load_config).grid(row=0, column=2, sticky="ew", padx=(8, 0))

        ttk.Label(right, text="JSON для отправки", style="Section.TLabel").grid(row=0, column=0, sticky="w")
        self.preview_text = tk.Text(
            right,
            height=18,
            wrap="word",
            font=("Consolas", 10),
            bg="#101828",
            fg="#f8fafc",
            insertbackground="#f8fafc",
            padx=12,
            pady=12,
            relief="flat",
        )
        self.preview_text.grid(row=1, column=0, sticky="nsew", pady=(8, 18))
        self.preview_text.configure(state="disabled")

        ttk.Label(right, text="Статус отправки", style="Section.TLabel").grid(row=2, column=0, sticky="w")
        self.log_text = tk.Text(
            right,
            height=12,
            wrap="word",
            font=("Consolas", 10),
            bg="#fffdf8",
            fg="#1d2939",
            padx=12,
            pady=12,
            relief="solid",
            borderwidth=1,
        )
        self.log_text.grid(row=3, column=0, sticky="nsew", pady=(8, 0))
        self.log_text.configure(state="disabled")
        self._append_log("Подключите ESP32 по USB и выберите COM-порт.")

    def _add_labeled_entry(
        self,
        parent: ttk.Frame,
        row: int,
        label: str,
        variable: tk.StringVar,
        show: str | None = None,
    ) -> int:
        ttk.Label(parent, text=label, style="Body.TLabel").grid(row=row, column=0, sticky="w", pady=(0, 10), padx=(0, 14))
        entry = ttk.Entry(parent, textvariable=variable, show=show if show else "")
        entry.grid(row=row, column=1, sticky="ew", pady=(0, 10))
        return row + 1

    def _bind_updates(self) -> None:
        for variable in self._tracked_vars:
            variable.trace_add("write", lambda *_: self.update_preview())

    def refresh_ports(self) -> None:
        ports = list(list_ports.comports())
        values = []
        detected_default = None

        for port in ports:
            item = port.device
            if port.description and port.description != port.device:
                item = f"{port.device} - {port.description}"
            values.append(item)
            if detected_default is None:
                detected_default = item

        self.port_combo["values"] = values

        if values:
            current = self.port_var.get()
            if current in values:
                return
            self.port_var.set(detected_default or values[0])
            self._append_log(f"Найдено портов: {len(values)}.")
            return

        self.port_var.set("")
        self._append_log("COM-порты не найдены.")

    def get_port_name(self) -> str:
        value = self.port_var.get().strip()
        if " - " in value:
            return value.split(" - ", 1)[0]
        return value

    def build_payload(self) -> dict:
        device_id = self.device_id_var.get().strip()
        ssid = self.wifi_ssid_var.get().strip()
        password = self.wifi_password_var.get()
        transport_type = self.transport_type_var.get().strip()
        broker_url = self.broker_url_var.get().strip()
        telemetry_topic = self.telemetry_topic_var.get().strip()
        command_topic = self.command_topic_var.get().strip()
        interval_raw = self.interval_var.get().strip()

        if not device_id:
            raise ValueError("Укажите Device ID.")
        if not ssid:
            raise ValueError("Укажите Wi-Fi SSID.")
        if not broker_url:
            raise ValueError("Укажите Broker URL.")
        if not telemetry_topic:
            raise ValueError("Укажите Telemetry topic.")
        if not command_topic:
            raise ValueError("Укажите Command topic.")

        try:
            interval = int(interval_raw)
        except ValueError as error:
            raise ValueError("Интервал телеметрии должен быть целым числом.") from error

        if interval < 500:
            raise ValueError("Интервал телеметрии должен быть не меньше 500 мс.")

        return {
            "deviceId": device_id,
            "wifi": {
                "ssid": ssid,
                "password": password,
            },
            "transport": {
                "type": transport_type or "mqtt_ws",
                "brokerUrl": broker_url,
                "telemetryTopic": telemetry_topic,
                "commandTopic": command_topic,
            },
            "sampling": {
                "telemetryIntervalMs": interval,
            },
        }

    def update_preview(self) -> None:
        try:
            payload = self.build_payload()
            preview = json.dumps(payload, ensure_ascii=False, indent=2)
        except ValueError as error:
            preview = f"Ошибка в форме:\n{error}"

        self.preview_text.configure(state="normal")
        self.preview_text.delete("1.0", tk.END)
        self.preview_text.insert("1.0", preview)
        self.preview_text.configure(state="disabled")

    def load_config(self) -> None:
        file_path = filedialog.askopenfilename(
            title="Выберите JSON-конфиг",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            initialdir=str(Path(__file__).resolve().parent),
        )
        if not file_path:
            return

        try:
            with open(file_path, "r", encoding="utf-8") as file:
                payload = json.load(file)
        except (OSError, json.JSONDecodeError) as error:
            messagebox.showerror("Ошибка загрузки", f"Не удалось открыть JSON.\n\n{error}")
            return

        try:
            self.device_id_var.set(str(payload["deviceId"]))
            self.wifi_ssid_var.set(str(payload["wifi"]["ssid"]))
            self.wifi_password_var.set(str(payload["wifi"]["password"]))
            self.transport_type_var.set(str(payload["transport"]["type"]))
            self.broker_url_var.set(str(payload["transport"]["brokerUrl"]))
            self.telemetry_topic_var.set(str(payload["transport"]["telemetryTopic"]))
            self.command_topic_var.set(str(payload["transport"]["commandTopic"]))
            self.interval_var.set(str(payload["sampling"]["telemetryIntervalMs"]))
        except (KeyError, TypeError) as error:
            messagebox.showerror(
                "Ошибка загрузки",
                f"JSON не соответствует ожидаемой структуре.\n\n{error}",
            )
            return

        self._append_log(f"Конфиг загружен: {file_path}")

    def save_config(self) -> None:
        try:
            payload = self.build_payload()
        except ValueError as error:
            messagebox.showerror("Ошибка сохранения", str(error))
            return

        file_path = filedialog.asksaveasfilename(
            title="Сохранить JSON-конфиг",
            defaultextension=".json",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
            initialfile=f"{payload['deviceId']}.json",
            initialdir=str(Path(__file__).resolve().parent),
        )
        if not file_path:
            return

        try:
            with open(file_path, "w", encoding="utf-8") as file:
                json.dump(payload, file, ensure_ascii=False, indent=2)
        except OSError as error:
            messagebox.showerror("Ошибка сохранения", f"Не удалось сохранить файл.\n\n{error}")
            return

        self._append_log(f"Конфиг сохранен: {file_path}")

    def send_to_device(self) -> None:
        if self._send_thread and self._send_thread.is_alive():
            return

        port_name = self.get_port_name()
        if not port_name:
            messagebox.showerror("Нет порта", "Выберите COM-порт.")
            return

        try:
            baudrate = int(self.baudrate_var.get().strip())
        except ValueError:
            messagebox.showerror("Ошибка", "Скорость порта должна быть целым числом.")
            return

        try:
            payload = self.build_payload()
        except ValueError as error:
            messagebox.showerror("Ошибка", str(error))
            return

        self.send_button.configure(state="disabled")
        self._append_log(f"Отправка конфигурации в {port_name}...")
        self._send_thread = threading.Thread(
            target=self._send_worker,
            args=(port_name, baudrate, payload),
            daemon=True,
        )
        self._send_thread.start()

    def _send_worker(self, port_name: str, baudrate: int, payload: dict) -> None:
        payload_text = json.dumps(payload, ensure_ascii=False) + "\n"
        deadline = time.time() + SERIAL_TIMEOUT_SECONDS
        response_lines: list[str] = []

        try:
            with serial.Serial(
                port=port_name,
                baudrate=baudrate,
                timeout=0.4,
                write_timeout=2,
            ) as connection:
                connection.reset_input_buffer()
                connection.write(payload_text.encode("utf-8"))
                connection.flush()

                while time.time() < deadline:
                    raw_line = connection.readline()
                    if not raw_line:
                        continue
                    decoded = raw_line.decode("utf-8", errors="replace").strip()
                    if decoded:
                        response_lines.append(decoded)
                        if len(response_lines) >= 4:
                            break

        except serial.SerialException as error:
            self._event_queue.put(("error", f"Не удалось открыть или использовать порт.\n\n{error}"))
            return
        except OSError as error:
            self._event_queue.put(("error", f"Ошибка обмена с устройством.\n\n{error}"))
            return

        if response_lines:
            self._event_queue.put(("success", "Ответ устройства:\n" + "\n".join(response_lines)))
            return

        self._event_queue.put(
            (
                "success",
                "Конфигурация отправлена. Ответ от платы не получен за отведенное время.",
            )
        )

    def _drain_events(self) -> None:
        while True:
            try:
                event_type, message = self._event_queue.get_nowait()
            except queue.Empty:
                break

            self.send_button.configure(state="normal")
            self._append_log(message)
            if event_type == "error":
                messagebox.showerror("Ошибка отправки", message)
            elif event_type == "success":
                messagebox.showinfo("Готово", message)

        self.root.after(150, self._drain_events)

    def _append_log(self, message: str) -> None:
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state="disabled")


def main() -> None:
    root = tk.Tk()
    app = ConfiguratorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()