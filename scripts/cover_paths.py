"""Keep shared user settings, assets and optional downloads outside the skill."""
import os
from pathlib import Path
import sys

def data_directory():
    override = os.environ.get("COVER_WORKBENCH_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home()/"AppData"/"Local")
    elif sys.platform == "darwin":
        base = Path.home()/"Library"/"Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home()/".local"/"share")
    return base/"cover-workbench"
