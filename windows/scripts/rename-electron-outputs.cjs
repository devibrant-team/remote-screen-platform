const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "..", "dist-electron");
if (!fs.existsSync(dir)) process.exit(0);
for (const f of fs.readdirSync(dir)) {
  if (f.endsWith(".js")) fs.renameSync(path.join(dir, f), path.join(dir, f.replace(/\.js$/, ".cjs")));
}
console.log("Renamed dist-electron/*.js → *.cjs");
