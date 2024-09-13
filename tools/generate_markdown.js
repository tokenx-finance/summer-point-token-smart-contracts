const fs = require("fs");

function jsonToMarkdown(jsonData) {
  let markdown =
    "| File                               | Status | Lines Covered | Total Lines | Percentage | Functions Covered | Total Functions | Branches Covered | Total Branches |\n"; // Added 'Percentage' column
  markdown +=
    "|------------------------------------|--------|---------------|-------------|------------|-------------------|-----------------|------------------|----------------|\n";

  for (const filePath in jsonData) {
    const coverageData = jsonData[filePath];
    const linesCovered = Object.values(coverageData.l).reduce((acc, val) => acc + val, 0);
    const totalLines = Object.keys(coverageData.l).length + linesCovered;
    const percentage = ((linesCovered / totalLines) * 100).toFixed(1) + "%";
    const functionsCovered = Object.keys(coverageData.fnMap).length;
    const totalFunctions = Object.keys(coverageData.f).length;
    const branchesCovered = Object.keys(coverageData.branchMap).length;
    const totalBranches = Object.keys(coverageData.b).length;

    let status = "";
    if (parseFloat(percentage) > 80) {
      status = "🟢";
    } else if (parseFloat(percentage) <= 80 && parseFloat(percentage) >= 60) {
      status = "🟡";
    } else {
      status = "🔴";
    }

    markdown += `| ${filePath} | ${status} | ${linesCovered} | ${totalLines} | ${percentage} | ${functionsCovered} | ${totalFunctions} | ${branchesCovered} | ${totalBranches} |\n`;
  }

  return markdown;
}

const jsonFilePath = "./coverage.json";
fs.readFile(jsonFilePath, "utf8", (err, data) => {
  if (err) {
    console.error(`Error reading JSON file: ${err}`);
    return;
  }

  const jsonData = JSON.parse(data);
  const markdown = jsonToMarkdown(jsonData);
  console.log(markdown);
});
