#!/usr/bin/env python3
"""Exercise the real Bash installer with native curl, hashing, git, and install.

Run: python3 scripts/test-install-sh.py
Source cases additionally require Bun on PATH (or S2P_TEST_BUN=/path/to/bun).
All fixtures and subprocess logs are retained under the printed temporary root.
HTTPS requests are routed by curl's normal configuration to a local TLS server
with a test CA; the installer has no test-only URL or trust bypass. Source fetches
use Git's normal URL rewrite to a local repository with distinct release tags.
"""

import hashlib
import http.server
import json
import os
from pathlib import Path
import resource
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "install.sh"
OWNER = "Dicklesworthstone"
REPO = "source_to_prompt_tui"
VERSION = "v0.3.4"
PAYLOAD = b'''#!/bin/sh
if [ -n "${S2P_TEST_EXEC_LOG:-}" ]; then printf 'executed\n' >> "$S2P_TEST_EXEC_LOG"; fi
printf 's2p v0.3.4\n'
'''
PREVIOUS_PAYLOAD = b"#!/bin/sh\nprintf 'previous installation\\n'\n"


class ReleaseServer(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        scenario = self.server.scenario
        self.server.requests.append(self.path)
        if self.path.endswith("/releases/latest"):
            status = scenario.get("latest_status", 200)
            body = json.dumps({"tag_name": VERSION}).encode()
            interrupted = False
        elif self.path.endswith(".sha256") or self.path == "/custom-checksum":
            status = scenario.get("checksum_status", 200)
            asset = self.path.rsplit("/", 1)[-1].removesuffix(".sha256")
            payload = scenario.get("payload", PAYLOAD)
            body = scenario.get("checksum", (hashlib.sha256(payload).hexdigest() + "  " + asset + "\n").encode())
            interrupted = scenario.get("interrupt_checksum", False)
            if "copy_file_limit" in scenario:
                # The download already completed. Limit the installer parent so
                # the next native install, not curl, encounters SIGXFSZ mid-copy.
                if not self.server.installer_started.wait(5):
                    raise RuntimeError("Installer PID was not available")
                limit = scenario["copy_file_limit"]
                resource.prlimit(self.server.installer_pid, resource.RLIMIT_FSIZE, (limit, limit))
        else:
            status = scenario.get("binary_status", 200)
            body = scenario.get("payload", PAYLOAD)
            interrupted = scenario.get("interrupt_binary", False)
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(body) + (100 if interrupted else 0)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        if interrupted:
            self.connection.shutdown(socket.SHUT_WR)
            self.close_connection = True


class InstallerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for command in ("bash", "curl", "git", "openssl", "install"):
            if not shutil.which(command):
                raise RuntimeError("Required native test tool is missing: " + command)
        cls.root = Path(tempfile.mkdtemp(prefix="s2p-installer-tests-", dir=os.environ.get("S2P_INSTALL_TEST_ROOT")))
        cls.root.chmod(0o755)
        print("Retained installer test artifacts:", cls.root, flush=True)
        cls.bash = shutil.which("bash")
        cls.bun = os.environ.get("S2P_TEST_BUN") or shutil.which("bun")
        cls.native_tools = cls.root / "native-tools"
        cls.native_tools.mkdir()
        if cls.bun:
            (cls.native_tools / "bun").symlink_to(Path(cls.bun).resolve())
        cls.cert = cls.root / "tls-cert.pem"
        key = cls.root / "tls-key.pem"
        config = cls.root / "tls.cnf"
        config.write_text("[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n"
                          "[dn]\nCN=github.com\n[ext]\nsubjectAltName=DNS:github.com,DNS:api.github.com\n"
                          "basicConstraints=critical,CA:TRUE\n")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-config", str(config), "-keyout", str(key), "-out", str(cls.cert)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), ReleaseServer)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cls.cert, key)
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        cls.server.scenario = {}
        cls.server.requests = []
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.source = cls.root / "source-repository"
        cls.source.mkdir()
        cls.git("init", "-q", "--initial-branch=main")
        cls.git("config", "user.name", "Installer Regression")
        cls.git("config", "user.email", "installer-regression@example.invalid")
        cls.commits = {}
        for version in ("v0.3.3", VERSION, "v9.9.9"):
            (cls.source / "package.json").write_text(json.dumps({
                "name": "installer-fixture", "version": version[1:], "scripts": {"build:bin": "sh build.sh"}}))
            (cls.source / "build.sh").write_text("mkdir -p dist && cp payload dist/s2p\n")
            (cls.source / "payload").write_text("#!/bin/sh\nprintf 's2p " + version + "\\n'\n")
            cls.git("add", "package.json", "build.sh", "payload")
            cls.git("commit", "-q", "-m", version)
            cls.git("tag", version)
            cls.commits[version] = cls.git("rev-parse", "HEAD").strip()
        # A same-named branch must not override the older release tag.
        cls.git("branch", "v0.3.3", "HEAD")
        (cls.source / "dist").mkdir()
        (cls.source / "dist" / "s2p").write_text("#!/bin/sh\nprintf 'stale build\\n'\n")
        (cls.source / "build.sh").write_text("cp nonexistent-build-input dist/s2p\n")
        cls.git("add", "build.sh", "dist/s2p")
        cls.git("commit", "-q", "-m", "real build failure with stale output")
        cls.git("tag", "v0.3.5-broken")

    @classmethod
    def git(cls, *args):
        return subprocess.run(["git", "-C", str(cls.source), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        print("Retained installer test artifacts:", cls.root, flush=True)

    def setUp(self):
        self.case = self.root / self.id().rsplit(".", 1)[-1]
        self.case.mkdir()
        self.case.chmod(0o755)
        self.server.scenario = {}
        self.server.requests = []
        self.runs = 0

    def run_installer(self, *, flags=(), version=VERSION, scenario=None, env_extra=None,
                      no_hash=False, directory_target=False, symlink_target=False,
                      restrict_privileges=False):
        self.runs += 1
        run_dir = self.case / str(self.runs)
        run_dir.mkdir()
        run_dir.chmod(0o755)
        dest = run_dir / "dest"
        dest.mkdir()
        dest.chmod(0o755)
        installed = dest / "s2p"
        external = None
        if directory_target:
            installed.mkdir()
        elif symlink_target:
            external = run_dir / "external-s2p"
            external.write_bytes(PREVIOUS_PAYLOAD)
            external.chmod(0o755)
            installed.symlink_to(external)
        else:
            installed.write_bytes(PREVIOUS_PAYLOAD)
            installed.chmod(0o755)
        previous_inode = installed.stat().st_ino
        tmp_dir = run_dir / "tmp"
        tmp_dir.mkdir()
        tmp_dir.chmod(0o777)
        config_dir = run_dir / "curl-config"
        config_dir.mkdir()
        port = self.server.server_port
        (config_dir / ".curlrc").write_text(
            'noproxy = "*"\ncacert = "' + str(self.cert) + '"\n'
            'connect-to = "github.com:443:127.0.0.1:' + str(port) + '"\n'
            'connect-to = "api.github.com:443:127.0.0.1:' + str(port) + '"\n')
        git_config = run_dir / "git-config"
        git_config.write_text('[url "' + self.source.as_uri() + '"]\n'
                              '\tinsteadOf = https://github.com/' + OWNER + '/' + REPO + '.git\n')
        env = os.environ.copy()
        for name in ("BASH_ENV", "VERSION", "OWNER", "REPO", "BINARY", "DEST", "CHECKSUM_URL"):
            env.pop(name, None)
        env.update({"CURL_HOME": str(config_dir), "TMPDIR": str(tmp_dir),
                    "GIT_CONFIG_GLOBAL": str(git_config), "GIT_CONFIG_SYSTEM": os.devnull,
                    "GIT_TERMINAL_PROMPT": "0", "BUN_INSTALL_CACHE_DIR": str(tmp_dir / "bun-cache"),
                    "S2P_TEST_EXEC_LOG": str(tmp_dir / "execution.log"),
                    "S2P_TEST_DEST": str(dest),
                    "PATH": str(dest) + os.pathsep + str(self.native_tools) + os.pathsep + env["PATH"]})
        if no_hash:
            isolated = run_dir / "no-hash-bin"
            isolated.mkdir()
            for command in ("curl", "uname", "tr", "grep", "head", "sed", "mkdir", "cat", "mktemp", "rm", "chmod", "install", "mv"):
                executable = shutil.which(command)
                if executable:
                    (isolated / command).symlink_to(executable)
            env["PATH"] = str(dest) + os.pathsep + str(isolated)
        if env_extra:
            env.update(env_extra)
        self.server.scenario = scenario or {}
        self.server.requests = []
        self.server.installer_started = threading.Event()
        command = [self.bash, str(INSTALLER), "--dest", str(dest)]
        if version is not None:
            command += ["--version", version]
        command += list(flags)
        if restrict_privileges and os.geteuid() == 0:
            command = [shutil.which("setpriv"), "--bounding-set=-dac_override,-dac_read_search", "--", *command]
        process = subprocess.Popen(command, env=env, cwd=run_dir, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True)
        self.server.installer_pid = process.pid
        self.server.installer_started.set()
        try:
            output, _ = process.communicate(timeout=45)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
        result = subprocess.CompletedProcess(command, process.returncode, output)
        (run_dir / "installer.log").write_text(result.stdout)
        (run_dir / "requests.json").write_text(json.dumps(self.server.requests, indent=2))
        result.installed = installed
        result.previous_inode = previous_inode
        result.external = external
        result.execution_log = tmp_dir / "execution.log"
        return result

    def assert_failure(self, result, message, *, unchanged=True):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(message, result.stdout)
        self.assertNotIn("Installed s2p", result.stdout)
        self.assertNotIn("Done. Run:", result.stdout)
        if unchanged:
            self.assertEqual(result.installed.read_bytes(), PREVIOUS_PAYLOAD)

    def require_bun(self):
        if not self.bun:
            self.skipTest("Real Bun is required for source-build integration cases")

    def test_matching_release_checksums(self):
        digest = hashlib.sha256(PAYLOAD).hexdigest()
        for flags, checksum in (((), None), (("--verify",), (" \t" + digest.upper() + "\r\n\r\n").encode())):
            with self.subTest(flags=flags):
                scenario = {} if checksum is None else {"checksum": checksum}
                result = self.run_installer(flags=flags, scenario=scenario)
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("Checksum verified", result.stdout)
                self.assertEqual(result.installed.read_bytes(), PAYLOAD)

    def test_mismatch_is_fatal_with_and_without_verify(self):
        for flags in ((), ("--verify",)):
            with self.subTest(flags=flags):
                result = self.run_installer(flags=flags, scenario={"checksum": b"0" * 64 + b"\n"})
                self.assert_failure(result, "Checksum mismatch")
                self.assertFalse(result.execution_log.exists())

    def test_malformed_checksum_is_never_optional(self):
        digest = hashlib.sha256(PAYLOAD).hexdigest().encode()
        for checksum in (b"", b" \t\r\n", b"garbage\n", digest + b"\n" + digest + b"\n",
                         digest + b"  wrong-asset\n", digest + b"  s2p extra-field\n",
                         digest[:20] + b"\0" + digest[20:] + b"\n"):
            for flags in ((), ("--verify",)):
                with self.subTest(checksum=checksum, flags=flags):
                    result = self.run_installer(flags=flags, scenario={"checksum": checksum})
                    self.assert_failure(result, "hecksum")
                    self.assertFalse(result.execution_log.exists())

    def test_only_missing_default_metadata_is_optional(self):
        for status in (404, 410):
            with self.subTest(status=status):
                result = self.run_installer(scenario={"checksum_status": status})
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("proceeding without verification", result.stdout)
                self.assertNotIn("Checksum verified", result.stdout)
                required = self.run_installer(flags=("--verify",), scenario={"checksum_status": status})
                self.assert_failure(required, "Checksum required")
        for status in (403, 500):
            result = self.run_installer(scenario={"checksum_status": status})
            self.assert_failure(result, "Checksum required")
        explicit = self.run_installer(scenario={"checksum_status": 404},
                                      env_extra={"CHECKSUM_URL": "https://github.com/custom-checksum"})
        self.assert_failure(explicit, "Checksum required")

    def test_hash_utility_absence_cannot_claim_verification(self):
        for flags in ((), ("--verify",)):
            with self.subTest(flags=flags):
                result = self.run_installer(flags=flags, no_hash=True)
                self.assert_failure(result, "No SHA256 utility")
                self.assertFalse(result.execution_log.exists())
        optional = self.run_installer(no_hash=True, scenario={"checksum_status": 404})
        self.assertEqual(optional.returncode, 0, optional.stdout)
        self.assertNotIn("Checksum verified", optional.stdout)
        self.assertEqual(optional.installed.read_bytes(), PAYLOAD)

    def test_interrupted_binary_and_checksum_abort(self):
        for interrupted in ("interrupt_binary", "interrupt_checksum"):
            for flags in ((), ("--verify",)):
                with self.subTest(interrupted=interrupted, flags=flags):
                    result = self.run_installer(flags=flags, scenario={interrupted: True})
                    self.assert_failure(result, "Download failed")
                    self.assertNotIn("Building release", result.stdout)
                    self.assertFalse(result.execution_log.exists())

    def test_server_error_does_not_trigger_source_fallback(self):
        result = self.run_installer(scenario={"binary_status": 500})
        self.assert_failure(result, "Release download failed")
        self.assertNotIn("Building release", result.stdout)

    def test_failed_destination_write_is_not_success_or_source_fallback(self):
        # The native install command must propagate a real filesystem error even
        # when the suite runs as root: this basename exceeds NAME_MAX.
        result = self.run_installer(env_extra={"BINARY": "s2p-" + "x" * 300})
        self.assert_failure(result, "Could not install")
        self.assertIn("Checksum verified", result.stdout)
        self.assertNotIn("Building release", result.stdout)

    def test_existing_destination_directory_is_rejected(self):
        result = self.run_installer(directory_target=True)
        self.assert_failure(result, "Install destination is a directory", unchanged=False)
        self.assertEqual(list(result.installed.iterdir()), [])

    @unittest.skipUnless(hasattr(resource, "prlimit"), "Linux prlimit is needed for a real mid-copy failure")
    def test_interrupted_upgrade_copy_preserves_existing_executable(self):
        payload = PAYLOAD + b"#" + b"x" * 16384 + b"\n"
        result = self.run_installer(flags=("--verify",),
                                    scenario={"payload": payload, "copy_file_limit": 4096})
        self.assertIn("Checksum verified", result.stdout)
        self.assert_failure(result, "Could not install")
        self.assertEqual(result.installed.stat().st_ino, result.previous_inode)
        self.assertEqual(subprocess.check_output([str(result.installed)], text=True).strip(), "previous installation")
        self.assertEqual(list(result.installed.parent.glob(".s2p-install.*")), [])

    def test_successful_upgrade_publishes_complete_executable(self):
        payload = PAYLOAD + b"#" + b"x" * 16384 + b"\n"
        result = self.run_installer(flags=("--verify",), scenario={"payload": payload})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.installed.read_bytes(), payload)
        self.assertNotEqual(result.installed.stat().st_ino, result.previous_inode)
        self.assertEqual(subprocess.check_output([str(result.installed), "--version"], text=True).strip(), "s2p v0.3.4")
        self.assertEqual(list(result.installed.parent.glob(".s2p-install.*")), [])

    def test_failed_staged_readiness_preserves_existing_executable(self):
        payload = b"#!/bin/sh\nexec /nonexistent/s2p-regression-program\n"
        result = self.run_installer(flags=("--verify",), scenario={"payload": payload})
        self.assertIn("Checksum verified", result.stdout)
        self.assert_failure(result, "Artifact does not run")
        self.assertEqual(result.installed.stat().st_ino, result.previous_inode)
        self.assertEqual(list(result.installed.parent.glob(".s2p-install.*")), [])

    def test_failed_publish_preserves_existing_executable(self):
        if os.geteuid() == 0 and not shutil.which("setpriv"):
            self.skipTest("Root needs setpriv to exercise native directory permissions")
        payload = b"#!/bin/sh\nchmod 0555 \"$S2P_TEST_DEST\"\nprintf 's2p v0.3.4\\n'\n"
        result = self.run_installer(flags=("--verify",), scenario={"payload": payload},
                                    restrict_privileges=True)
        try:
            self.assert_failure(result, "Could not publish")
            self.assertEqual(result.installed.stat().st_ino, result.previous_inode)
            self.assertEqual(subprocess.check_output([str(result.installed)], text=True).strip(), "previous installation")
            # A directory made unwritable after staging also prevents removal of
            # that private directory; this is reported, never treated as success.
            self.assertIn("Could not remove private staging directory", result.stdout)
        finally:
            result.installed.parent.chmod(0o755)

    def test_symlink_upgrade_does_not_overwrite_external_target(self):
        result = self.run_installer(flags=("--verify",), symlink_target=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertFalse(result.installed.is_symlink())
        self.assertEqual(result.installed.read_bytes(), PAYLOAD)
        self.assertEqual(result.external.read_bytes(), PREVIOUS_PAYLOAD)
        self.assertEqual(list(result.installed.parent.glob(".s2p-install.*")), [])

    def test_directory_appearing_during_readiness_is_not_a_container(self):
        payload = (b"#!/bin/sh\n"
                   b"mv \"$S2P_TEST_DEST/s2p\" \"$S2P_TEST_DEST/previous-s2p\" && "
                   b"mkdir \"$S2P_TEST_DEST/s2p\"\n")
        result = self.run_installer(flags=("--verify",), scenario={"payload": payload})
        self.assert_failure(result, "Install destination is a directory", unchanged=False)
        self.assertTrue(result.installed.is_dir())
        self.assertEqual(list(result.installed.iterdir()), [])
        self.assertEqual((result.installed.parent / "previous-s2p").read_bytes(), PREVIOUS_PAYLOAD)
        self.assertEqual(list(result.installed.parent.glob(".s2p-install.*")), [])

    def test_binary_name_cannot_escape_private_staging(self):
        for name in ("../s2p", "subdir/s2p", "subdir\\s2p", ".", ".."):
            with self.subTest(name=name):
                result = self.run_installer(env_extra={"BINARY": name})
                self.assert_failure(result, "Binary name must be a single filename")
                self.assertEqual(self.server.requests, [])

    def test_latest_is_resolved_once_to_pinned_download_urls(self):
        result = self.run_installer(version=None, flags=("--verify",))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(sum(path.endswith("/releases/latest") for path in self.server.requests), 1)
        self.assertTrue(any("/download/" + VERSION + "/" in path for path in self.server.requests))
        self.assertFalse(any("/latest/download/" in path for path in self.server.requests))

    def test_latest_resolution_failure_is_fatal(self):
        result = self.run_installer(version=None, scenario={"latest_status": 503})
        self.assert_failure(result, "Could not resolve the latest release")
        self.assertEqual(len(self.server.requests), 1)

    def test_release_ref_is_one_encoded_url_segment(self):
        result = self.run_installer(version="v0.3.4+build/tag%name", flags=("--verify",))
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue(all("/download/v0.3.4%2Bbuild%2Ftag%25name/" in path
                            for path in self.server.requests))

    def test_verification_never_silently_becomes_a_source_build(self):
        explicit = self.run_installer(flags=("--from-source", "--verify"))
        self.assert_failure(explicit, "cannot combine it with a source build")
        self.assertEqual(self.server.requests, [])
        for status in (404, 410):
            fallback = self.run_installer(flags=("--verify",), scenario={"binary_status": status})
            self.assert_failure(fallback, "required checksum verification cannot use a source build")
            self.assertNotIn("Building release", fallback.stdout)
        checksum_override = self.run_installer(flags=("--from-source",),
                                               env_extra={"CHECKSUM_URL": "https://github.com/custom-checksum"})
        self.assert_failure(checksum_override, "cannot combine it with a source build")

    def test_source_build_uses_tag_instead_of_default_or_same_named_branch(self):
        self.require_bun()
        result = self.run_installer(flags=("--from-source",), version="v0.3.3")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn(self.commits["v0.3.3"], result.stdout)
        self.assertNotIn("Checksum verified", result.stdout)
        version = subprocess.check_output([str(result.installed), "--version"], text=True).strip()
        self.assertEqual(version, "s2p v0.3.3")
        self.assertEqual(self.server.requests, [])

    def test_source_build_accepts_an_exact_commit(self):
        self.require_bun()
        commit = self.commits["v0.3.3"]
        result = self.run_installer(flags=("--from-source",), version=commit)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn(commit, result.stdout)
        self.assertIn(b"s2p v0.3.3", result.installed.read_bytes())

    def test_missing_binary_fallback_builds_resolved_release_without_sidecar(self):
        self.require_bun()
        result = self.run_installer(version=None, scenario={"binary_status": 404})
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn(self.commits[VERSION], result.stdout)
        self.assertIn(b"s2p v0.3.4", result.installed.read_bytes())
        self.assertNotIn("Checksum verified", result.stdout)
        self.assertFalse(any(path.endswith(".sha256") for path in self.server.requests))

    def test_missing_source_ref_is_fatal(self):
        self.require_bun()
        result = self.run_installer(flags=("--from-source",), version="v0.0.0-missing")
        self.assert_failure(result, "Could not fetch release ref")

    def test_failed_build_does_not_install_stale_output(self):
        self.require_bun()
        result = self.run_installer(flags=("--from-source",), version="v0.3.5-broken")
        self.assert_failure(result, "Source build failed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
