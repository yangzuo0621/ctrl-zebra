process.stderr.write("fixture stderr\n");
process.stdin.on("data", (chunk) => {
  process.stdout.write(chunk);
});
process.stdin.resume();
