// test the validator against the APIs of https://apis.guru
const Validator = require("../../index.js");
const validator = new Validator();
const { writeFileSync } = require("fs");
const fetch = require("node-fetch");
const { argv, exit } = require("process");
const JSYaml = require("js-yaml");
const { createReport } = require("./createReport.js");
const yamlOpts = { schema: JSYaml.JSON_SCHEMA };
const failedFile = `${__dirname}/failed.json`;
const newFailedFile = `${__dirname}/failed.updated.json`;
const newReportFile = `${__dirname}/failed.updated.md`;
const defaultPercentage = 10;

const failedData = require(failedFile);
const failedMap = new Map(Object.entries(failedData));

function sample(fullMap, percentage) {
  const { floor, random } = Math;
  const len = fullMap.size;
  const size = floor(len * (percentage / 100));
  const sampleMap = new Map();
  const mapKeys = Array.from(fullMap.keys());
  for (let i = 0; i < size; i++) {
    let index;
    let key;
    do {
      index = floor(random() * len);
      key = mapKeys[index];
    } while (sampleMap.has(key));

    sampleMap.set(key, fullMap.get(key));
  }
  return sampleMap;
}

function unescapeJsonPointer(str) {
  return str.replace(/~1/g, "/").replace(/~0/g, "~");
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function makeRexp(pathItem) {
  const res = unescapeJsonPointer(pathItem);
  return escapeRegExp(res);
}

function yamlLine(yamlSpec, path) {
  const lines = yamlSpec.split("\n");
  const paths = path.split("/").slice(1);
  let num = 0;
  for (pathItem of paths) {
    if (Number.isInteger(+pathItem) && num ) {
      num = findArrayItem(lines, num, pathItem);
    } else {
      num = findItem(lines, num, pathItem);
    }
  }
  return num + 1;
}

function findArrayItem(lines, num, pathIdx) {
  if (num > lines.length-2){
    return num;
  };
  const firstItem = lines[num + 1];
  const match = firstItem.match(/^\s*-/);
  if (match === null) {
    // it was not an array index, but a key
    return findItem(lines, num, pathItem);
  }
  const prefix = match[0];
  while (pathIdx > 0) {
    num++;
    if (lines[num].startsWith(prefix)) {
      pathIdx--;
    }
  }
  return num + 1;
}

function findItem(lines, num, pathItem) {
  const token = new RegExp(`^\\s*"?${makeRexp(pathItem)}"?:`);
  const maxNum = lines.length-1;
  while (!lines[num].match(token) && num < maxNum ) {
    num++;
  }
  return num;
}

function getInstanceValue(yamlSpec, path) {
  if (path === "") {
    return [false,'content too large'];
  }
  const obj = JSYaml.load(yamlSpec, yamlOpts);
  const paths = path.split("/").slice(1);
  const result = paths.reduce((o, n) => o[unescapeJsonPointer(n)], obj);
  return [true,result];
}

function yamlToGitHub(url) {
  return url.replace(
    "https://api.apis.guru/v2/specs/",
    "https://github.com/APIs-guru/openapi-directory/blob/main/APIs/"
  );
}

async function fetchApiList(percentage, onlyFailed = false) {
  const response = await fetch("https://api.apis.guru/v2/list.json");

  if (!response.ok) {
    throw new Error("Unable to download real-world APIs from apis.guru");
  }
  const apiList = await response.json();
  const apiMap = new Map();
  for (const key in apiList) {
    if (!onlyFailed || failedMap.has(key)) {
      const api = apiList[key];
      const latestVersion = api.versions[api.preferred];
      apiMap.set(key, {
        name: key,
        apiVersion: api.preferred,
        openApiVersion: latestVersion.openapiVer,
        yamlUrl: latestVersion.swaggerYamlUrl,
        jsonUrl: latestVersion.swaggerUrl,
        gitHubUrl: yamlToGitHub(latestVersion.swaggerYamlUrl),
        updated: latestVersion.updated,
      });
    }
  }
  if (percentage !== 100) {
    console.log(
      `testing a random set containing ${percentage}% of ${apiMap.size} available APIs`
    );
    return sample(apiMap, percentage);
  }
  console.log(`testing all ${apiMap.size} available APIs`);
  return apiMap;
}

async function fetchYaml(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to download ${url}`);
  }

  return await response.text();
}

async function testAPIs(percentage, onlyFailed) {
  if (onlyFailed) {
    percentage = 100;
  }
  const apiList = await fetchApiList(percentage, onlyFailed);
  const failed = new Map();
  const results = {
    total: apiList.size,
    current: 0,
    valid: 0,
    invalid: 0,
    knownFailed: 0,
  };
  for (const [name, api] of apiList) {
    const spec = await fetchYaml(api.yamlUrl);
    results.current++;
    api.result = await validator.validate(spec);
    if (api.result.valid === true) {
      results.valid++;
    } else {
      results.invalid++;
      api.result.errors.map((item) => {
        const [res,value] = getInstanceValue(spec, item.instancePath);
        item.hasInstanceValue = res;
        item.instanceValue = value;
        item.gitHubUrl = `${api.gitHubUrl}#L${yamlLine(
          spec,
          item.instancePath
        )}`;
      });
      if (failedMap.has(name)) {
        const failedApiErrors = JSON.stringify(
          failedMap.get(name).result.errors
        );
        if (failedApiErrors === JSON.stringify(api.result.errors)) {
          results.knownFailed++;
          api.knownFailed = true;
        }
      }
      failed.set(name, api);
    }
    console.log(JSON.stringify(results), name);
  }
  console.log(
    `Finished testing ${results.total} APIs
     ${results.invalid} tests failed of which ${results.knownFailed} were known failures`
  );
  if (
    results.knownFailed !== results.invalid ||
    (onlyFailed && results.invalid !== results.total)
  ) {
    if (percentage === 100) {
      const data = Object.fromEntries(failed);
      console.log(`new/updated failures found`);
      console.log(`creating ${newFailedFile}`);
      writeFileSync(
        newFailedFile,
        JSON.stringify(data, null, 2),
        "utf8"
      );
      console.log(`creating new report ${newReportFile}`);
      writeFileSync(
        newReportFile,
        createReport(data),
        "utf8"
      );
    }
    process.exit(1);
  }
}

function parseArgs() {
  const args = argv.slice(2);
  const params = new Set();
  const opts = ["failedOnly", "all"];
  args.forEach((arg) => {
    opts.forEach((opt) => {
      if (`--${opt}`.startsWith(arg)) {
        params.add(opt);
      }
    });
  });
  if (params.size !== args.length) {
    console.log(`
        usage: ${argv[1].split("/").pop()} [--failedOnly] [--all]
        where: 
        --failedOnly will only try all APIs that have previously been found failing
        --all will test all APIs on the list, by default only ${defaultPercentage}% of APIs will be tested.
        `);
    exit(1);
  }
  return params;
}

const params = parseArgs();
const failedOnly = params.has("failedOnly");
const percentage = params.has("all") ? 100 : defaultPercentage;
testAPIs(percentage, failedOnly);