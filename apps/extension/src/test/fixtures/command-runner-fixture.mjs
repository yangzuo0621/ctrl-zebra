const mode = process.argv[2];

if (mode === "stream") {
  process.stdout.write("stdout-one\n");
  process.stderr.write("stderr-one\n");
  process.stdout.write("stdout-two\n");
} else if (mode === "nonzero") {
  process.stderr.write("expected failure\n");
  process.exitCode = 7;
} else if (mode === "wait") {
  process.stdout.write("ready\n");
  setInterval(() => {
    process.stdout.write("still-running\n");
  }, 1_000);
} else {
  process.stderr.write("unknown fixture mode\n");
  process.exitCode = 2;
}
