"""Kept for old instructions: re-copies Signoff's shared files. Use tools/sync_vendor.py."""
import pathlib
import runpy

runpy.run_path(str(pathlib.Path(__file__).with_name("sync_vendor.py")), run_name="__main__")
