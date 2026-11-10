#!/usr/bin/python3
"""ENKYRON UX-15B-FIDO1 — local proof of one physical FIDO2 authenticator.

Uses the Debian python3-fido2 1.2.0 API. An explicit one-shot test creates a
non-discoverable (resident_key discouraged) TEST credential and verifies a
fresh assertion with REQUIRED user verification. This does NOT enroll a CEO,
write any database or file, establish a session, or unlock the desktop.
The credentials are never printed or persisted; real login requires a later
durable server-side credential registry and a trusted authorization boundary.

The operator's GitHub and ChatGPT registrations/PINs are never altered.
Do not set or reset a PIN, even if the key reports that no PIN is configured.
"""
from __future__ import annotations

import getpass
import os
import secrets
import sys
from importlib.metadata import version

ORIGIN = "https://enkyron.localhost"
RP_ID = "enkyron.localhost"
EXPECTED_FIDO2 = "1.2.0"


def check_single_device(devices):
    """Never guess among multiple HID devices."""
    if len(devices) != 1:
        raise RuntimeError("Connect exactly one FIDO2 key and retry.")
    return devices[0]


def configured_user_verification(options):
    """Read-only info; 'clientPin' false means supported but NOT configured."""
    if not isinstance(options, dict):
        return False
    return options.get("clientPin") is True or options.get("uv") is True


def user_interaction_type():
    # Lazy imports allow CI to unit-test pure state checks without USB or fido2.
    from fido2.client import UserInteraction

    class LocalInteraction(UserInteraction):
        def __init__(self):
            self._pin = None

        def prompt_up(self):
            print("Touch your plugged-in Yubico when it flashes.", file=sys.stderr)

        def request_pin(self, permissions, rd_id):
            if self._pin is None:
                self._pin = getpass.getpass(
                    "Existing FIDO2 PIN (terminal only; do not share): "
                )
                if not self._pin:
                    raise RuntimeError("Empty FIDO2 PIN; operation cancelled")
            return self._pin

        def request_uv(self, permissions, rd_id):
            print("User verification required on the key.", file=sys.stderr)
            return True

        def clear(self):
            self._pin = None

    return LocalInteraction


def prove():
    from fido2.client import Fido2Client
    from fido2.hid import CtapHidDevice
    from fido2.server import Fido2Server
    from fido2.utils import websafe_encode

    devices = list(CtapHidDevice.list_devices())
    device = check_single_device(devices)
    interaction = user_interaction_type()()
    try:
        client = Fido2Client(device, ORIGIN, user_interaction=interaction)
        info = client.info
        if not configured_user_verification(info.options):
            raise RuntimeError(
                "User verification is not configured on this key. "
                "No PIN was set or changed; registration not attempted."
            )

        server = Fido2Server({"id": RP_ID, "name": "ENKYRON local Founder proof"},
                             attestation="none")
        options, state = server.register_begin(
            {"id": os.urandom(32), "name": "founder-local-proof",
             "displayName": "ENKYRON Founder (temporary cryptographic test)"},
            resident_key_requirement="discouraged",
            user_verification="required",
            authenticator_attachment="cross-platform",
        )
        print("CREATE_TEST_CREDENTIAL: touch key; enter your existing FIDO2 PIN if prompted.")
        created = client.make_credential(options["publicKey"])
        auth_data = server.register_complete(
            state, created.client_data, created.attestation_object
        )
        credential = auth_data.credential_data
        if credential is None or not auth_data.is_user_verified():
            raise RuntimeError("Registration failed required user verification")
        print("FIDO_REGISTRATION_CHALLENGE_AND_UV: VERIFIED")

        request, login_state = server.authenticate_begin(
            [credential], user_verification="required"
        )
        print("SIGN_FRESH_CHALLENGE: touch key again if prompted.")
        assertion = client.get_assertion(request["publicKey"]).get_response(0)
        verified = server.authenticate_complete(
            login_state, [credential], assertion.credential_id,
            assertion.client_data, assertion.authenticator_data,
            assertion.signature,
        )
        if verified.credential_id != credential.credential_id:
            raise RuntimeError("Credential mismatch after verified signature")
        if not assertion.authenticator_data.is_user_verified():
            raise RuntimeError("Assertion missing verified-user flag")
        print("FIDO_FRESH_LOGIN_SIGNATURE_AND_UV: VERIFIED")

        bad_signature = bytes([assertion.signature[0] ^ 1]) + assertion.signature[1:]
        try:
            server.authenticate_complete(
                login_state, [credential], assertion.credential_id,
                assertion.client_data, assertion.authenticator_data, bad_signature,
            )
        except ValueError:
            # python-fido2 1.2.0 rejects an invalid signature with ValueError.
            pass
        else:
            raise RuntimeError("SECURITY FAILURE: modified signature accepted")
        print("MODIFIED_SIGNATURE: DENIED")

        changed_state = dict(login_state)
        changed_state["challenge"] = websafe_encode(secrets.token_bytes(32))
        try:
            server.authenticate_complete(
                changed_state, [credential], assertion.credential_id,
                assertion.client_data, assertion.authenticator_data,
                assertion.signature,
            )
        except ValueError:
            pass
        else:
            raise RuntimeError("SECURITY FAILURE: wrong challenge accepted")
        print("WRONG_CHALLENGE: DENIED")

        print("DATABASE_WRITES: NONE")
        print("PERSISTED_ENKYRON_CREDENTIAL: NO")
        print("FOUNDER_LOGIN_TO_DESKTOP: NOT_YET_ENABLED")
        print("PROOF_RESULT: PASS")
    finally:
        interaction.clear()


def main():
    if sys.argv != [sys.argv[0], "--prove"]:
        print("Usage: /usr/bin/python3 scripts/enkyron-fido2-ceremony.py --prove",
              file=sys.stderr)
        return 2
    if not (sys.stdin.isatty() and sys.stderr.isatty()):
        print("This FIDO2 ceremony requires an interactive local terminal.",
              file=sys.stderr)
        return 2
    installed = version("fido2")
    if installed != EXPECTED_FIDO2:
        print("Wrong fido2 version; expected " + EXPECTED_FIDO2
              + ", got " + installed, file=sys.stderr)
        return 2
    print("ENKYRON: physical-key cryptographic proof only (no account login).")
    print("This creates one non-discoverable TEST credential; it will NOT be saved")
    print("to ENKYRON. Your existing GitHub/ChatGPT credentials stay separate.")
    print("No PIN changes/resets, no database writes. Do not guess a forgotten PIN.")
    if input("Type PROVE to proceed (anything else cancels): ").strip() != "PROVE":
        print("CANCELLED; no credential operation attempted.")
        return 2
    try:
        prove()
    except Exception as err:
        # No traceback and no PIN, credential ID, public-key bytes, or serial.
        print("PROOF_RESULT: FAILED (" + type(err).__name__ + ")", file=sys.stderr)
        if isinstance(err, RuntimeError):
            print(str(err), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
