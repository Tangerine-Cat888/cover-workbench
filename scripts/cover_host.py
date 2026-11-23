"""Optional desktop host adapter. Other hosts can pass --output-dir."""
import os
from pathlib import Path
from uuid import UUID

def current_chat():
    identifier = os.environ.get("COVER_WORKBENCH_CHAT_ID") or os.environ.get("CODEX_THREAD_ID")
    supplied = os.environ.get("COVER_WORKBENCH_CHAT_DIR")
    return identifier or (str(Path(supplied).expanduser().resolve()) if supplied else "")

def chat_directory(thread):
    supplied = os.environ.get("COVER_WORKBENCH_CHAT_DIR")
    if supplied:
        return Path(supplied).expanduser().resolve()
    try:
        chat = str(UUID(thread))
    except (ValueError, AttributeError):
        return None
    home = Path(os.environ.get("CODEX_HOME") or Path.home()/".codex")
    matches = [path for path in (home/"visualizations").glob(f"????/??/??/{chat}") if path.is_dir()]
    return matches[0].resolve() if len(matches) == 1 else None
