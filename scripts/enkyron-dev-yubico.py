#!/usr/bin/python3
"""Single-user ENKYRON DEVELOPMENT launcher: Yubico then desktop.

First use: register ONE FIDO2 public-key credential locally.
Later: verify a fresh Yubico signature and launch ENKYRON.
This is a convenient local UI unlock, NOT trusted DB authorization: the Linux
user can still access PostgreSQL or run desktop/enkyron.py directly.
Never changes GitHub/ChatGPT credentials or the Yubico's PIN.
"""
import base64
import getpass
import json
import os
import stat
from pathlib import Path
import sys

RP = "enkyron.localhost"
ORIGIN = "https://enkyron.localhost"
RECORD = Path.home() / ".local/share/enkyron/auth/founder-dev-fido.json"
DESKTOP = Path(__file__).resolve().parent.parent / "desktop/enkyron.py"


def readable_record():
    try:
        fd = os.open(RECORD, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            entry = os.fstat(stream.fileno())
            if (not stat.S_ISREG(entry.st_mode)
                    or entry.st_uid != os.getuid() or entry.st_nlink != 1
                    or (entry.st_mode & 0o077) != 0):
                raise RuntimeError("Unsafe saved local FIDO credential")
            if entry.st_size > 8192:
                raise RuntimeError("Oversized saved local FIDO credential")
            value = json.load(stream)
    except FileNotFoundError:
        return None
    if (not isinstance(value, dict) or value.get("format") != 1
            or value.get("rp") != RP or not isinstance(value.get("credential"), str)):
        raise RuntimeError("Invalid local FIDO credential; refusing to bypass authentication")
    try:
        raw = base64.b64decode(value["credential"], validate=True)
        if not 50 <= len(raw) <= 4096:
            raise ValueError("size")
        return raw
    except (ValueError, TypeError) as exc:
        raise RuntimeError("Malformed local FIDO credential") from exc


def save_new_record(credential_bytes):
    folder = RECORD.parent
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    st = folder.lstat()
    if (not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid()
            or (st.st_mode & 0o077) != 0):
        raise RuntimeError("Unsafe local ENKYRON auth directory")
    payload = json.dumps({
        "format": 1, "rp": RP,
        "credential": base64.b64encode(bytes(credential_bytes)).decode("ascii"),
    }).encode("utf8")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    fd = os.open(RECORD, flags, 0o600)  # Never overwrite an existing registration
    with os.fdopen(fd, "wb") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())


def interaction_class():
    from fido2.client import UserInteraction

    class Interaction(UserInteraction):
        def prompt_up(self):
            print("Touch the Yubico when it flashes.", flush=True)

        def request_pin(self, permissions, rd_id):
            pin = getpass.getpass("Existing Yubico FIDO2 PIN: ")
            if not pin:
                raise RuntimeError("PIN entry cancelled")
            return pin

        def request_uv(self, permissions, rd_id):
            return True

    return Interaction


def unlock(stored):
    from fido2.client import Fido2Client
    from fido2.hid import CtapHidDevice
    from fido2.server import Fido2Server
    from fido2.webauthn import AttestedCredentialData

    devices = list(CtapHidDevice.list_devices())
    if len(devices) != 1:
        raise RuntimeError("Plug in exactly one Yubico")
    client = Fido2Client(devices[0], ORIGIN, user_interaction=interaction_class()())
    if not any(str(v).startswith("FIDO_2_") for v in client.info.versions):
        raise RuntimeError("FIDO2 required")
    if not (client.info.options.get("clientPin") is True
            or client.info.options.get("uv") is True):
        raise RuntimeError("FIDO2 user verification not configured; no PIN will be changed")

    server = Fido2Server({"id": RP, "name": "ENKYRON development"}, attestation="none")
    if stored is None:
        print("First use: register ONE Yubico for local ENKYRON development.")
        if input("Type ENROLL to register this key: ").strip() != "ENROLL":
            raise RuntimeError("Registration cancelled")
        options, state = server.register_begin(
            {"id": os.urandom(32), "name": "founder", "displayName": "Founder"},
            resident_key_requirement="discouraged",
            user_verification="required",
            authenticator_attachment="cross-platform",
        )
        created = client.make_credential(options["publicKey"])
        verified = server.register_complete(
            state, created.client_data, created.attestation_object
        )
        if not verified.is_user_verified() or not verified.credential_data:
            raise RuntimeError("FIDO2 registration without required verification")
        save_new_record(verified.credential_data)
        print("Yubico registered for local ENKYRON development.")
    else:
        credential = AttestedCredentialData(stored)
        options, state = server.authenticate_begin(
            [credential], user_verification="required"
        )
        response = client.get_assertion(options["publicKey"]).get_response(0)
        verified = server.authenticate_complete(
            state, [credential], response.credential_id,
            response.client_data, response.authenticator_data, response.signature,
        )
        if (verified.credential_id != credential.credential_id
                or not response.authenticator_data.is_user_verified()):
            raise RuntimeError("FIDO2 signature / PIN verification failed")
        print("Yubico verified. Opening ENKYRON.")

    os.execv("/usr/bin/python3", ["/usr/bin/python3", str(DESKTOP)])


def main():
    if len(sys.argv) != 1 or not (sys.stdin.isatty() and sys.stderr.isatty()):
        print("Run in your local terminal: /usr/bin/python3 scripts/enkyron-dev-yubico.py",
              file=sys.stderr)
        return 2
    try:
        unlock(readable_record())
    except Exception as error:
        # Never display PIN or raw credential material in error output.
        print("ENKYRON Yubico: refused (" + type(error).__name__ + ")", file=sys.stderr)
        if isinstance(error, RuntimeError):
            print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
