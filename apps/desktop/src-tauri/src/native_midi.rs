#[cfg(target_os = "macos")]
mod imp {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc::{sync_channel, SyncSender};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    use midir::os::unix::VirtualInput;
    use midir::{Ignore, MidiInput, MidiInputConnection};
    use serde_json::json;

    const PORT_NAME: &str = "LEDrums";
    const ENDPOINT: &str = "/api/native-midi";
    const QUEUE_DEPTH: usize = 1024;

    pub struct NativeMidiBridge {
        connection: Option<MidiInputConnection<()>>,
        sender: Option<SyncSender<String>>,
        worker: Option<JoinHandle<()>>,
    }

    impl NativeMidiBridge {
        pub fn start(port: u16, host_token: String) -> Result<Self, String> {
            let (tx, rx) = sync_channel::<String>(QUEUE_DEPTH);
            let worker = thread::spawn(move || {
                while let Ok(body) = rx.recv() {
                    if let Err(err) = post_json(port, &host_token, &body) {
                        eprintln!("[native-midi] post failed: {err}");
                    }
                }
            });

            let callback_tx = tx.clone();
            let mut midi_in = MidiInput::new("LEDrums Native MIDI")
                .map_err(|e| format!("create MIDI input: {e}"))?;
            midi_in.ignore(Ignore::None);
            let connection = midi_in
                .create_virtual(
                    PORT_NAME,
                    move |_stamp, message, _| {
                        if let Some(body) = midi_message_json(message) {
                            if callback_tx.try_send(body).is_err() {
                                eprintln!("[native-midi] input queue full; dropping message");
                            }
                        }
                    },
                    (),
                )
                .map_err(|e| format!("create virtual MIDI destination: {e}"))?;

            println!("[native-midi] virtual destination ready: {PORT_NAME}");
            Ok(Self {
                connection: Some(connection),
                sender: Some(tx),
                worker: Some(worker),
            })
        }
    }

    impl Drop for NativeMidiBridge {
        fn drop(&mut self) {
            let _ = self.connection.take();
            let _ = self.sender.take();
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }

    fn midi_message_json(message: &[u8]) -> Option<String> {
        if message.len() < 2 {
            return None;
        }
        let raw_status = *message.first()?;
        let status = raw_status & 0xf0;
        let channel = (raw_status & 0x0f) + 1;

        let value = match status {
            0x80 if message.len() >= 3 => json!({
                "t": "midi",
                "note": message[1],
                "velocity": 0,
                "on": false,
                "channel": channel,
            }),
            0x90 if message.len() >= 3 => {
                let velocity = message[2];
                json!({
                    "t": "midi",
                    "note": message[1],
                    "velocity": velocity,
                    "on": velocity > 0,
                    "channel": channel,
                })
            }
            0xb0 if message.len() >= 3 => json!({
                "t": "cc",
                "controller": message[1],
                "value": message[2],
                "channel": channel,
            }),
            0xc0 => json!({
                "t": "programChange",
                "value": message[1],
                "channel": channel,
            }),
            _ => return None,
        };
        Some(value.to_string())
    }

    fn post_json(port: u16, host_token: &str, body: &str) -> Result<(), String> {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
        let timeout = Some(Duration::from_millis(250));
        let _ = stream.set_write_timeout(timeout);
        let _ = stream.set_read_timeout(timeout);
        let request = format!(
            "POST {ENDPOINT}?hostToken={host_token} HTTP/1.1\r\n\
             Host: 127.0.0.1:{port}\r\n\
             Content-Type: application/json\r\n\
             Content-Length: {}\r\n\
             Connection: close\r\n\
             \r\n\
             {body}",
            body.len(),
        );
        stream
            .write_all(request.as_bytes())
            .map_err(|e| e.to_string())?;

        let mut response = [0_u8; 64];
        let n = stream.read(&mut response).unwrap_or(0);
        if n == 0 {
            return Ok(());
        }
        let status = std::str::from_utf8(&response[..n]).unwrap_or("");
        if status.starts_with("HTTP/1.1 2") {
            Ok(())
        } else {
            Err(status.lines().next().unwrap_or("HTTP error").to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub struct NativeMidiBridge;

    impl NativeMidiBridge {
        pub fn start(_port: u16, _host_token: String) -> Result<Self, String> {
            Ok(Self)
        }
    }
}

pub use imp::NativeMidiBridge;
