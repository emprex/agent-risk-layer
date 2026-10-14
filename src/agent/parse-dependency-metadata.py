#!/usr/bin/env python3
"""Parse inert dependency metadata supplied on stdin; never import target code."""
import json
import re
import sys
import tomllib

MAX_COMPONENTS = 500
NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\[[^]]+\])?\s*(.*)$")


def safe_spec(value):
    value = str(value or "").strip()
    # Do not retain URLs, credentials, or command snippets from source files.
    if len(value) > 100 or "://" in value or "@" in value or "\n" in value:
        return "non_registry_or_unresolved"
    return value[:80]



# Yarn Classic (v1) and Berry (v2+) store stanza selectors with a
# 'version' attribute. This bounded metadata scan never loads YAML tags,
# resolves registries, or executes hooks. It is NOT a deployed SBOM.
YARN_SELECTOR = re.compile(r'(?:^|,\s*)"?((?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9][A-Za-z0-9_.-]*)@')
YARN_VERSION = re.compile(r'^\s+version(?:\s+|:\s*)(?:"([^"]+)"|([^\s#]+))\s*    raw = sys.stdin.buffer.read(16_000_001)
    if len(raw) > 16_000_000:
        raise ValueError("input budget exceeded")
    batch = json.loads(raw)
    output = {
        "schema": "arl.dependency-inventory.candidate.v1",
        "filesParsed": 0, "filesUnsupported": 0, "filesInvalid": 0,
        "unresolvedDirectives": 0, "declaredCount": 0, "lockedCount": 0,
        "components": [],
        "omittedComponents": 0,
        "unresolvedByReason": {},
        "unsupportedByFormat": {},
        "yarnFormats": {"classic": 0, "berry": 0},
        "yarnStanzasResolved": 0,
    }

    def unresolved(reason):
        output["unresolvedDirectives"] += 1
        output["unresolvedByReason"][reason] = output["unresolvedByReason"].get(reason, 0) + 1

    def component(kind, ecosystem, name, requested, file):
        name = str(name or "")[:120]
        if not re.fullmatch(r"(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            unresolved("invalid_component_identity")
            return
        field = "lockedCount" if kind == "locked" else "declaredCount"
        output[field] += 1
        if len(output["components"]) >= MAX_COMPONENTS:
            output["omittedComponents"] += 1
            return
        output["components"].append({
            "kind": kind, "ecosystem": ecosystem, "name": name,
            "versionOrConstraint": safe_spec(requested),
            "sourcePathHash": file["pathHash"],
            "sourceContentSha256": file["contentSha256"]
        })

    def requirements(lines, file):
        for line in lines.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("-") or "://" in line or line.startswith("git+"):
                unresolved("requires_directive_or_external_resolution")
                continue
            match = NAME.match(line.split("#", 1)[0])
            if not match:
                unresolved("unrecognized_requirements_line")
                continue
            component("declared", "pypi", match[1], match[2], file)

    for file in batch.get("files", []):
        name = file["basename"].lower()
        text = file["text"]
        try:
            if name == "pyproject.toml":
                obj = tomllib.loads(text)
                deps = list(obj.get("project", {}).get("dependencies", []))
                deps += [d for group in obj.get("project", {}).get("optional-dependencies", {}).values() for d in group]
                deps += [d for group in obj.get("dependency-groups", {}).values() if isinstance(group, list) for d in group if isinstance(d, str)]
                for spec in deps:
                    if not isinstance(spec, str):
                        unresolved("invalid_requirement_record")
                        continue
                    match = NAME.match(spec)
                    if match:
                        component("declared", "pypi", match[1], match[2], file)
                    else:
                        unresolved("unrecognized_pyproject_requirement")
                for pkg, spec in obj.get("tool", {}).get("poetry", {}).get("dependencies", {}).items():
                    if pkg.lower() != "python":
                        component("declared", "pypi", pkg, spec if isinstance(spec, str) else "complex_constraint", file)
            elif name.startswith("requirements") and name.endswith(".txt"):
                requirements(text, file)
            elif name in ("uv.lock", "poetry.lock", "pdm.lock"):
                obj = tomllib.loads(text)
                for pkg in obj.get("package", []):
                    if isinstance(pkg, dict) and pkg.get("name") and pkg.get("version"):
                        component("locked", "pypi", pkg["name"], pkg["version"], file)
                    else:
                        unresolved("unrecognized_lock_record")
            elif name == "package.json":
                obj = json.loads(text)
                for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
                    for pkg, spec in obj.get(section, {}).items():
                        component("declared", "npm", pkg, spec, file)
            elif name in ("package-lock.json", "npm-shrinkwrap.json"):
                obj = json.loads(text)
                for key, pkg in obj.get("packages", {}).items():
                    if not key or not isinstance(pkg, dict):
                        continue
                    pkg_name = key.rsplit("node_modules/", 1)[-1]
                    if pkg.get("version"):
                        component("locked", "npm", pkg_name, pkg["version"], file)
                    else:
                        unresolved("npm_lock_missing_version")
            elif name == "pipfile.lock":
                obj = json.loads(text)
                for section in ("default", "develop"):
                    for pkg, spec in obj.get(section, {}).items():
                        version = spec.get("version") if isinstance(spec, dict) else spec
                        component("locked", "pypi", pkg, version, file)
            elif name == "yarn.lock":
                if not parse_yarn(text, file, component, unresolved, output):
                    output["filesInvalid"] += 1
                    continue
            else:
                output["filesUnsupported"] += 1
                output["unsupportedByFormat"][name] = output["unsupportedByFormat"].get(name, 0) + 1
                continue
            output["filesParsed"] += 1
        except (ValueError, TypeError, KeyError, AttributeError, tomllib.TOMLDecodeError):
            output["filesInvalid"] += 1

    output["components"].sort(key=lambda p: (
        p["ecosystem"], p["name"].lower(), p["kind"], p["versionOrConstraint"], p["sourcePathHash"]
    ))
    print(json.dumps(output, separators=(",", ":"), ensure_ascii=True))


if __name__ == "__main__":
    main()
)


def parse_yarn(text, file, component, unresolved, output):
    classic = "# yarn lockfile v1" in text.lower()
    berry = bool(re.search(r"(?m)^__metadata:\s*$", text))
    if not (classic or berry):
        return False
    output["yarnFormats"]["classic" if classic else "berry"] += 1
    header = None
    version = None

    def flush():
        if header is None or header == "__metadata":
            return
        selectors = YARN_SELECTOR.findall(header)
        if not selectors:
            unresolved("yarn_unrecognized_selector")
            return
        if not version:
            unresolved("yarn_stanza_missing_version")
            return
        # Every selector is a candidate reference, not proof of installed state.
        # Duplicate selectors in one stanza resolve to the same version.
        for package in sorted(set(selectors)):
            component("locked", "npm", package, version, file)
        output["yarnStanzasResolved"] += 1

    for line in text.splitlines():
        if line and not line[0].isspace() and line.rstrip().endswith(":") and not line.lstrip().startswith("#"):
            flush()
            header = line.rstrip().removesuffix(":").strip().strip('"')
            version = None
        elif header is not None:
            match = YARN_VERSION.match(line)
            if match:
                version = match[1] or match[2]
    flush()
    return True


def main():
    raw = sys.stdin.buffer.read(16_000_001)
    if len(raw) > 16_000_000:
        raise ValueError("input budget exceeded")
    batch = json.loads(raw)
    output = {
        "schema": "arl.dependency-inventory.candidate.v1",
        "filesParsed": 0, "filesUnsupported": 0, "filesInvalid": 0,
        "unresolvedDirectives": 0, "declaredCount": 0, "lockedCount": 0,
        "components": [],
        "omittedComponents": 0,
    }

    def component(kind, ecosystem, name, requested, file):
        name = str(name or "")[:120]
        if not re.fullmatch(r"(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9][A-Za-z0-9_.-]*", name):
            output["unresolvedDirectives"] += 1
            return
        field = "lockedCount" if kind == "locked" else "declaredCount"
        output[field] += 1
        if len(output["components"]) >= MAX_COMPONENTS:
            output["omittedComponents"] += 1
            return
        output["components"].append({
            "kind": kind, "ecosystem": ecosystem, "name": name,
            "versionOrConstraint": safe_spec(requested),
            "sourcePathHash": file["pathHash"],
            "sourceContentSha256": file["contentSha256"]
        })

    def requirements(lines, file):
        for line in lines.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("-") or "://" in line or line.startswith("git+"):
                output["unresolvedDirectives"] += 1
                continue
            match = NAME.match(line.split("#", 1)[0])
            if not match:
                output["unresolvedDirectives"] += 1
                continue
            component("declared", "pypi", match[1], match[2], file)

    for file in batch.get("files", []):
        name = file["basename"].lower()
        text = file["text"]
        try:
            if name == "pyproject.toml":
                obj = tomllib.loads(text)
                deps = list(obj.get("project", {}).get("dependencies", []))
                deps += [d for group in obj.get("project", {}).get("optional-dependencies", {}).values() for d in group]
                deps += [d for group in obj.get("dependency-groups", {}).values() if isinstance(group, list) for d in group if isinstance(d, str)]
                for spec in deps:
                    if not isinstance(spec, str):
                        output["unresolvedDirectives"] += 1
                        continue
                    match = NAME.match(spec)
                    if match:
                        component("declared", "pypi", match[1], match[2], file)
                    else:
                        output["unresolvedDirectives"] += 1
                for pkg, spec in obj.get("tool", {}).get("poetry", {}).get("dependencies", {}).items():
                    if pkg.lower() != "python":
                        component("declared", "pypi", pkg, spec if isinstance(spec, str) else "complex_constraint", file)
            elif name.startswith("requirements") and name.endswith(".txt"):
                requirements(text, file)
            elif name in ("uv.lock", "poetry.lock", "pdm.lock"):
                obj = tomllib.loads(text)
                for pkg in obj.get("package", []):
                    if isinstance(pkg, dict) and pkg.get("name") and pkg.get("version"):
                        component("locked", "pypi", pkg["name"], pkg["version"], file)
                    else:
                        output["unresolvedDirectives"] += 1
            elif name == "package.json":
                obj = json.loads(text)
                for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
                    for pkg, spec in obj.get(section, {}).items():
                        component("declared", "npm", pkg, spec, file)
            elif name in ("package-lock.json", "npm-shrinkwrap.json"):
                obj = json.loads(text)
                for key, pkg in obj.get("packages", {}).items():
                    if not key or not isinstance(pkg, dict):
                        continue
                    pkg_name = key.rsplit("node_modules/", 1)[-1]
                    if pkg.get("version"):
                        component("locked", "npm", pkg_name, pkg["version"], file)
                    else:
                        output["unresolvedDirectives"] += 1
            elif name == "pipfile.lock":
                obj = json.loads(text)
                for section in ("default", "develop"):
                    for pkg, spec in obj.get(section, {}).items():
                        version = spec.get("version") if isinstance(spec, dict) else spec
                        component("locked", "pypi", pkg, version, file)
            else:
                output["filesUnsupported"] += 1
                continue
            output["filesParsed"] += 1
        except (ValueError, TypeError, KeyError, AttributeError, tomllib.TOMLDecodeError):
            output["filesInvalid"] += 1

    output["components"].sort(key=lambda p: (
        p["ecosystem"], p["name"].lower(), p["kind"], p["versionOrConstraint"], p["sourcePathHash"]
    ))
    print(json.dumps(output, separators=(",", ":"), ensure_ascii=True))


if __name__ == "__main__":
    main()
