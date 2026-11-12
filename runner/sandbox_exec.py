"""Guest supervisor. This file runs ONLY as PID 1 inside the private namespace.

Frames and artifacts are untrusted execution output; the host validates both.
No host-writable mount, credential, socket, or service-manager access is exposed.
"""
import json
import os
import selectors
import signal
import stat
import subprocess
import time

MAX_OUTPUT = 40 * 1024
MAX_FILE = 200 * 1024
MAX_ARTIFACTS = 4 * 1024 * 1024
SKIP = {"node_modules", ".git", "__pycache__", ".venv", "dist", "build"}


def frame(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)


def reap_children():
    # PID 1 is protected from kill(-1). Every other process belongs to this job,
    # including descendants which changed process groups or became orphaned.
    try:
        os.kill(-1, signal.SIGKILL)
    except ProcessLookupError:
        pass  # No remaining descendants is already the desired state.
    while True:
        try:
            os.waitpid(-1, 0)
        except ChildProcessError:
            return


def copy_inputs(source, dest):
    os.mkdir(dest, 0o700)
    for entry in os.scandir(source):
        target = os.path.join(dest, entry.name)
        if entry.is_dir(follow_symlinks=False):
            copy_inputs(entry.path, target)
        elif entry.is_file(follow_symlinks=False):
            with open(entry.path, "rb") as src, open(target, "xb") as out:
                out.write(src.read(2 * 1024 * 1024 + 1))
        else:
            raise RuntimeError("non-regular input")


def artifacts(root):
    budget = {"entries": 0, "files": 0, "bytes": 0}

    def walk(folder, prefix="", depth=0):
        if depth > 32:
            return
        with os.scandir(folder) as entries:
            for entry in entries:
                budget["entries"] += 1
                if budget["entries"] > 4096 or budget["files"] >= 128:
                    return
                if entry.name in SKIP or entry.is_symlink():
                    continue
                rel = prefix + entry.name
                try:
                    if entry.is_dir(follow_symlinks=False):
                        walk(entry.path, rel + "/", depth + 1)
                    elif entry.is_file(follow_symlinks=False):
                        fd = os.open(entry.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                        with os.fdopen(fd, "rb") as stream:
                            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                                continue
                            data = stream.read(MAX_FILE + 1)
                        if len(data) > MAX_FILE or b"\0" in data or budget["bytes"] + len(data) > MAX_ARTIFACTS:
                            continue
                        try:
                            text = data.decode("utf-8")
                        except UnicodeDecodeError:
                            continue
                        frame({"type": "file", "path": rel, "text": text})
                        budget["files"] += 1
                        budget["bytes"] += len(data)
                except OSError:
                    continue

    walk(root)


def main():
    if os.getpid() != 1:
        raise RuntimeError("guest supervisor requires its own PID namespace")
    with open("/input/job.json", encoding="utf-8") as stream:
        job = json.load(stream)
    os.mkdir("/workspace/tmp", 0o700)
    copy_inputs("/input/files", "/workspace/src")
    child = subprocess.Popen(["/bin/sh", "-c", job["command"]], cwd="/workspace/src", stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, close_fds=True, start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + job["timeoutMs"] / 1000
    total = 0
    timed_out = False
    while selector.get_map():
        if time.monotonic() >= deadline:
            timed_out = True
            break
        for key, _ in selector.select(min(0.1, max(0, deadline - time.monotonic()))):
            data = os.read(key.fileobj.fileno(), 8192)
            if not data:
                selector.unregister(key.fileobj)
                continue
            if total < MAX_OUTPUT:
                frame({"type": "chunk", "data": data[:MAX_OUTPUT - total].decode("utf-8", "replace")})
            if total <= MAX_OUTPUT < total + len(data):
                frame({"type": "chunk", "data": "\n[output truncated]"})
            total += len(data)
        # A background process may keep the pipe open after the shell exits.
        if child.poll() is not None:
            # Kill orphan writers, then drain the remaining buffered output to
            # EOF rather than dropping the final chunks from a fast command.
            reap_children()
    selector.close()
    if child.poll() is None and not timed_out:
        try:
            child.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
    code = child.poll()
    reap_children()
    if timed_out:
        frame({"type": "chunk", "data": "\n[timed out]"})
        code = 124
    elif code is None:
        code = -1
    elif code < 0:
        code = min(255, 128 - code)
    artifacts("/workspace/src")
    frame({"type": "result", "code": code})


if __name__ == "__main__":
    main()
