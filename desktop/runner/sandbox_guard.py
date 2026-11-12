"""Host-side gate: verify actual kernel limits before executing bubblewrap."""
import json
import os
import pathlib
import sys
import ctypes
import errno


def main():
    limits = json.loads(sys.argv[1])
    cgroup = next(line[3:].strip() for line in pathlib.Path("/proc/self/cgroup").read_text().splitlines() if line.startswith("0::"))
    root = pathlib.Path("/sys/fs/cgroup") / cgroup.lstrip("/")
    for filename, maximum in [("memory.max", limits["memoryBytes"]), ("memory.swap.max", 0), ("pids.max", limits["pids"])]:
        value = (root / filename).read_text().strip()
        if value == "max" or int(value) > maximum:
            raise RuntimeError("unenforced cgroup limit: " + filename)
    quota, period = (root / "cpu.max").read_text().split()
    if quota == "max" or int(quota) * 100 > limits["cpuPercent"] * int(period):
        raise RuntimeError("unenforced cgroup limit: cpu.max")
    # User namespaces map this account's UID; key serials can still identify
    # owner-readable host keys. A clean env/private session keyring is not enough.
    numbers = {"aarch64": (217, 218, 219), "x86_64": (248, 249, 250)}.get(os.uname().machine)
    if numbers is None:
        raise RuntimeError("keyring filter verification unsupported on this architecture")
    if "Seccomp:\t2" not in pathlib.Path("/proc/self/status").read_text():
        raise RuntimeError("syscall filter missing")
    libc = ctypes.CDLL(None, use_errno=True)
    for number in numbers:
        # Intentionally invalid arguments: without the filter these calls yield
        # EFAULT/EINVAL/EOPNOTSUPP. No key is created or accessed by this probe.
        ctypes.set_errno(0)
        result = libc.syscall(ctypes.c_long(number), ctypes.c_long(-1 if number == numbers[2] else 0), 0, 0, 0, 0)
        if result != -1 or ctypes.get_errno() != errno.EPERM:
            raise RuntimeError("keyring syscall is not blocked")
    # A missing permit is also refusal: the runner may already have cleaned up
    # after cancellation before this delayed transient service began executing.
    if pathlib.Path(sys.argv[2]).read_text() != "active":
        raise RuntimeError("job cancelled before execution")
    os.execv(sys.argv[3], sys.argv[3:])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("native isolation refused: " + str(error), file=sys.stderr)
        sys.exit(125)
