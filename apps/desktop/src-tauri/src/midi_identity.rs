// A STABLE identity for the CoreMIDI virtual destination the shell publishes.
//
// CoreMIDI hands every freshly created virtual endpoint a random `kMIDIPropertyUniqueID` unless the
// creator sets one. Client apps (Sensory Percussion, Ableton) remember the endpoints you selected by
// that uniqueID — so a random one means every launch of LEDrums looks like a brand new device and
// has to be re-selected by hand. The fix is to mint the ID once, persist it next to the app's other
// state, and hand the same value to `NativeMidiBridge::start` on every later launch.
//
// Everything here is panic-free and dependency-free: it runs on the startup path of a packaged
// `.app` where a panic is invisible, and a failure to read the file must degrade to "a working port
// with a fresh identity", never to "no port".

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// File inside the app-data dir holding the endpoint ID as a decimal `i32`.
pub const ID_FILE_NAME: &str = "midi-endpoint-id";

/// Where the ID handed to CoreMIDI came from — the caller reports the abnormal cases.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointIdOrigin {
    /// The persisted file was read and reused. The steady state.
    Loaded,
    /// No file yet (first run on this machine): minted and written.
    Created,
    /// A file existed but held nothing usable: minted and overwritten.
    Regenerated,
}

/// The resolved endpoint identity plus enough context to report a degraded outcome.
#[derive(Debug, Clone)]
pub struct EndpointId {
    pub id: i32,
    pub origin: EndpointIdOrigin,
    /// `Some` when the value could not be written, i.e. this identity will NOT survive a restart.
    pub persist_error: Option<String>,
}

/// Mint an endpoint ID without any extra dependency: wall-clock nanoseconds mixed with the process
/// id, folded into the positive half of `i32` (CoreMIDI treats 0 as "invalid", and staying positive
/// keeps the value readable in `MIDI Studio`).
pub fn generate_unique_id() -> i32 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let pid = u64::from(std::process::id());
    let mixed = nanos ^ pid.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    let folded = ((mixed >> 32) ^ mixed) as u32;
    let id = (folded & 0x7fff_ffff) as i32;
    if id == 0 {
        // Astronomically unlikely; still, never hand CoreMIDI the invalid ID.
        0x4C45_4432 // 'LED2'
    } else {
        id
    }
}

/// Read the persisted endpoint ID from `dir`, minting and persisting one when there isn't a usable
/// value. Never panics; a directory that cannot be created or written degrades to an in-memory ID
/// with `persist_error` set.
pub fn load_or_create_unique_id(dir: &Path) -> EndpointId {
    let path = dir.join(ID_FILE_NAME);

    let existing = std::fs::read_to_string(&path).ok();
    let parsed = existing
        .as_deref()
        .map(str::trim)
        .and_then(|raw| raw.parse::<i32>().ok())
        .filter(|id| *id != 0);

    if let Some(id) = parsed {
        return EndpointId {
            id,
            origin: EndpointIdOrigin::Loaded,
            persist_error: None,
        };
    }

    // A file that exists but holds junk (truncated write, hand-edited, half-synced) is not an error
    // worth failing on — overwrite it so the NEXT launch is stable again.
    let origin = if existing.is_some() {
        EndpointIdOrigin::Regenerated
    } else {
        EndpointIdOrigin::Created
    };
    let id = generate_unique_id();
    let persist_error = persist(dir, &path, id).err();

    EndpointId {
        id,
        origin,
        persist_error,
    }
}

fn persist(dir: &Path, path: &Path, id: i32) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    std::fs::write(path, id.to_string()).map_err(|e| format!("write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory that removes itself, so these tests need no dev-dependency.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "ledrums-midi-id-{tag}-{}-{nanos}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create temp dir");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn stored(dir: &Path) -> String {
        std::fs::read_to_string(dir.join(ID_FILE_NAME)).expect("id file should exist")
    }

    #[test]
    fn generates_a_non_zero_positive_id() {
        let id = generate_unique_id();
        assert!(id > 0, "got {id}");
    }

    #[test]
    fn mints_and_persists_an_id_on_first_use() {
        let temp = TempDir::new("first");

        let resolved = load_or_create_unique_id(temp.path());

        assert_eq!(resolved.origin, EndpointIdOrigin::Created);
        assert!(resolved.id != 0);
        assert!(resolved.persist_error.is_none());
        assert_eq!(stored(temp.path()), resolved.id.to_string());
    }

    #[test]
    fn returns_the_same_id_on_every_later_call() {
        let temp = TempDir::new("stable");

        let first = load_or_create_unique_id(temp.path());
        let second = load_or_create_unique_id(temp.path());

        assert_eq!(
            second.id, first.id,
            "the endpoint identity must survive a restart"
        );
        assert_eq!(second.origin, EndpointIdOrigin::Loaded);
    }

    #[test]
    fn regenerates_and_overwrites_a_corrupt_file() {
        let temp = TempDir::new("corrupt");
        std::fs::write(temp.path().join(ID_FILE_NAME), "not-a-number").unwrap();

        let resolved = load_or_create_unique_id(temp.path());

        assert_eq!(resolved.origin, EndpointIdOrigin::Regenerated);
        assert!(resolved.id != 0);
        assert_eq!(stored(temp.path()), resolved.id.to_string());
        // …and the regenerated value is itself stable from then on.
        let next = load_or_create_unique_id(temp.path());
        assert_eq!(next.id, resolved.id);
        assert_eq!(next.origin, EndpointIdOrigin::Loaded);
    }

    #[test]
    fn treats_a_zero_id_as_unusable() {
        let temp = TempDir::new("zero");
        std::fs::write(temp.path().join(ID_FILE_NAME), "0").unwrap();

        let resolved = load_or_create_unique_id(temp.path());

        assert_eq!(resolved.origin, EndpointIdOrigin::Regenerated);
        assert!(resolved.id != 0, "0 is CoreMIDI's invalid unique id");
    }

    #[test]
    fn ignores_surrounding_whitespace_in_the_file() {
        let temp = TempDir::new("whitespace");
        std::fs::write(temp.path().join(ID_FILE_NAME), "  123456789\n").unwrap();

        let resolved = load_or_create_unique_id(temp.path());

        assert_eq!(resolved.id, 123_456_789);
        assert_eq!(resolved.origin, EndpointIdOrigin::Loaded);
    }

    #[test]
    fn creates_the_directory_when_it_is_missing() {
        let temp = TempDir::new("missing");
        let nested = temp.path().join("nested").join("app-data");

        let resolved = load_or_create_unique_id(&nested);

        assert_eq!(resolved.origin, EndpointIdOrigin::Created);
        assert!(resolved.persist_error.is_none());
        assert_eq!(stored(&nested), resolved.id.to_string());
    }

    #[test]
    fn degrades_to_an_unpersisted_id_when_the_path_is_unwritable() {
        let temp = TempDir::new("unwritable");
        // A FILE where the directory should be: create_dir_all fails, so nothing can be written.
        let blocked = temp.path().join("blocked");
        std::fs::write(&blocked, "i am a file").unwrap();

        let resolved = load_or_create_unique_id(&blocked);

        assert!(resolved.id != 0, "the port still gets an identity");
        assert!(
            resolved.persist_error.is_some(),
            "an unpersisted identity must be reportable"
        );
    }
}
