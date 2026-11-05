# TECH-001 — TCP, Ports, Sockets, and Network Exposure

**Version:** 0.1.0
**Status:** Draft — human technical review required
**Domain:** Network Engineering and AI-Agent Attack Surfaces
**Source:** Controlled Linux networking laboratory and engineering references

## 1. Engineering Objective

Distinguish between a listening process, a bound IP address,
a remotely reachable TCP port, an HTTP response, and a demonstrated
security control.

These are different technical claims.

## 2. Technical Foundation

A TCP connection normally starts with SYN, SYN-ACK, ACK (RFC 9293).

A TCP RST means a connection was reset or refused.
The packet alone does not prove whether the source was a host socket,
firewall, or intermediary.

127.0.0.1 is loopback within the relevant network namespace.

0.0.0.0 is an IPv4 wildcard bind.
Remote reachability still depends on interfaces, routing,
filtering, and network namespaces.

An interface-specific bind listens on the selected local address.

HTTP 200 OK establishes an HTTP response.
It does not prove secure authentication, authorization,
or safe AI-agent tool invocation.

## 3. Authorised Investigation Procedure

Before testing, record:

- Written authorization and rules of engagement.
- Exact source and destination.
- Interfaces, IP addresses, and ports.
- Target system version and environment.
- Test timestamps and expected behavior.

### Step 1 — Identify interfaces

    ip -br -4 address

### Step 2 — Inspect routing

    ip -4 route

### Step 3 — Identify listening sockets and processes

    sudo ss -lntp

### Step 4 — Test bounded HTTP connectivity

    curl -4 --noproxy '*' --connect-timeout 3 --max-time 5 -v -o /dev/null http://TARGET_IP:PORT/

### Step 5 — Check authorised TCP ports

    nmap -sT -Pn -p PORT1,PORT2 --reason TARGET_IP

### Step 6 — Capture relevant packets

    sudo tcpdump -i INTERFACE -nn -tttt 'tcp and (port PORT1 or port PORT2)'

### Step 7 — Correlate observations

Compare:

- Listening process and bind address.
- Source and destination network paths.
- SYN, SYN-ACK, ACK, RST, and timeout behavior.
- HTTP response and application behavior.
- Configuration and timestamp changes.

Packet captures may contain sensitive information.
Apply data minimisation, access control, and retention rules.

## 4. Interpreting Results

Nmap open:
The TCP connection succeeded.

Nmap closed:
The port was reachable but did not accept the connection,
or a device actively rejected it.

Nmap filtered:
Network behavior prevented a conclusive open/closed determination.

A timeout, RST, or HTTP status is not sufficient by itself
to establish the exact root cause.

A successful TCP connection does not demonstrate
authorization to use an API or agent tool.

Negative findings are bounded by the tested source,
destination, port, network path, configuration, and time.

## 5. Recorded Training Laboratory

Reported environment:

- Debian host: 192.168.122.1
- Kali guest: 192.168.122.223
- QEMU/KVM using libvirt

### Experiment A — Loopback-only service

Python HTTP server bound to 127.0.0.1:8000.

Observed:

- Local HTTP access succeeded.
- Remote connection to guest port 8000 was refused.
- Packet observation: SYN followed by RST-ACK.

### Experiment B — Interface-bound service

Python HTTP server bound to 192.168.122.223:8001.

Observed:

- Remote connection from Debian succeeded.
- HTTP response: 200 OK.

### Experiment C — Service shutdown

After stopping the port 8001 listener:

- Remote connection was refused.
- Nmap reported both tested guest ports closed from Debian.
- ss showed the remaining local-only listener on port 8000.

### Evidence Limitations

These are historical operator-reported training observations.
They have not been independently re-executed for this knowledge record.

Supported conclusion:

Binding and listener state affected connectivity
in the observed laboratory configuration.

No general firewall assurance, SSRF protection,
or AI-agent security conclusion follows from these observations alone.

## 6. ARL Assessment Evidence Requirements

For real customer assessments, preserve:

- Scope and written authorization.
- Target identity and exact snapshot or version.
- Source network position.
- Executed commands and tool versions.
- Timestamps and relevant outputs.
- Packet captures where appropriate.
- SHA-256 artifact checksums.
- Alternative explanations and limitations.
- Reviewer identity and evidence retention classification.

This knowledge sheet is reusable engineering guidance.

It is NOT customer assessment evidence.

It must NOT automatically produce a PASS, FAIL,
finding closure, or deployment approval.

## 7. Remediation and Exact Retesting

Document:

1. Observed network exposure.
2. System owner and authorised change.
3. Remediation implemented.
4. Updated system version and configuration.
5. Retest environment and network pathway.
6. Positive and negative verification results.
7. Differences from the original test conditions.
8. Human reviewer decision.

If the network path or target version materially changes,
record the change and qualify comparisons.

Do not claim exact retest completion
without appropriate comparable evidence.

## 8. Informative ARL Control Relationships

ARL-KB-005 — Trust Boundaries and Data Flows.
ARL-KB-011 — Asset and Agent Inventory.
ARL-KB-013 — Egress Destinations and Network Paths.
ARL-KB-054 — Tool Allowlisting and Environment Boundaries.
ARL-KB-057 — SSRF and Unsafe Egress.

These relationships provide engineering context.

A TCP connectivity test does not independently establish
the presence or absence of SSRF.

ARL's deterministic evidence workflow and
human-authorised decisions remain authoritative.

The LLM is not the security authority.

## 9. Engineering References

RFC 9293 — Transmission Control Protocol
https://www.rfc-editor.org/rfc/rfc9293

RFC 9110 — HTTP Semantics
https://www.rfc-editor.org/rfc/rfc9110

Linux ss(8)
https://man7.org/linux/man-pages/man8/ss.8.html

Nmap Port Scanning Basics
https://nmap.org/book/man-port-scanning-basics.html

Nmap TCP Connect Scan
https://nmap.org/book/scan-methods-connect-scan.html
