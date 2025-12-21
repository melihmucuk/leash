/** Commands that modify filesystem - blocked outside working directory */
export const DANGEROUS_COMMANDS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "mv",
  "cp",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "dd",
  "ln",
]);

/** Pattern to detect redirects to file paths (quoted or unquoted) */
export const REDIRECT_PATTERN =
  />{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;|&>]+))/g;

const DEVICE_PATHS = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

export const TEMP_PATHS = [
  "/tmp",
  "/var/tmp",
  "/private/tmp",
  "/private/var/tmp",
];

export const SAFE_WRITE_PATHS = [...DEVICE_PATHS, ...TEMP_PATHS];
