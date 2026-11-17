import errno
import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('near_gate',ROOT/'run.py')
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

class Gate(unittest.TestCase):
    def test_missing_dependency_cache_fails_before_execution(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(RuntimeError,'Dependency absent or changed'):
                gate.verify_dependencies(Path(d))

    def test_changed_lockfile_fails_before_execution(self):
        original=Path.read_bytes
        def read(path):
            if path==ROOT/'contract/Cargo.lock':return b'changed'
            return original(path)
        with patch.object(Path,'read_bytes',read):
            with self.assertRaisesRegex(RuntimeError,'Lockfile changed'):
                gate.verify_dependencies()

    def test_network_is_denied_by_os_not_merely_an_unused_rpc_setting(self):
        # Loopback attempt only, with no listener; require sandbox denial, not ECONNREFUSED.
        sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
        try:
            self.assertIn(sock.connect_ex(('127.0.0.1',9)),(errno.EPERM,errno.EACCES))
        finally:sock.close()

if __name__=='__main__':unittest.main()
