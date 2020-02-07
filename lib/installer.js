"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const tc = __importStar(require("@actions/tool-cache"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const semver = __importStar(require("semver"));
// Translations between actions input and Julia arch names
const osMap = {
    'win32': 'winnt',
    'darwin': 'mac',
    'linux': 'linux'
};
const archMap = {
    'x86': 'i686',
    'x64': 'x86_64'
};
// Store information about the environment
const osPlat = osMap[os.platform()]; // possible values: win32 (Windows), linux (Linux), darwin (macOS)
core.debug(`platform: ${osPlat}`);
/**
 * @returns The content of the downloaded versions.json file as object.
 */
function getJuliaVersionInfo() {
    return __awaiter(this, void 0, void 0, function* () {
        let versionsFile = tc.find('julia-versions', 'latest');
        if (!versionsFile) {
            versionsFile = yield tc.downloadTool('https://julialang-s3.julialang.org/bin/versions.json');
            tc.cacheFile(versionsFile, 'versions.json', 'julia-versions', 'latest');
        }
        return JSON.parse(fs.readFileSync(versionsFile).toString());
    });
}
exports.getJuliaVersionInfo = getJuliaVersionInfo;
/**
 * @returns An array of all Julia versions available for download
 */
function getJuliaVersions(versionInfo) {
    return __awaiter(this, void 0, void 0, function* () {
        let versions = [];
        for (var version in versionInfo) {
            versions.push(version);
        }
        return versions;
    });
}
exports.getJuliaVersions = getJuliaVersions;
function getJuliaVersion(availableReleases, versionInput) {
    return __awaiter(this, void 0, void 0, function* () {
        if (semver.valid(versionInput) == versionInput) {
            // versionInput is a valid version, use it directly
            return versionInput;
        }
        // nightlies
        if (versionInput == 'nightly') {
            return 'nightly';
        }
        // Use the highest available version that matches versionInput
        let version = semver.maxSatisfying(availableReleases, versionInput);
        if (version == null) {
            throw `Could not find a Julia version that matches ${versionInput}`;
        }
        // GitHub tags start with v, remove it
        version = version.replace(/^v/, '');
        return version;
    });
}
exports.getJuliaVersion = getJuliaVersion;
function getNightlyFileName(arch) {
    let versionExt, ext;
    if (osPlat == 'winnt') {
        versionExt = arch == 'x64' ? '-win64' : '-win32';
        ext = 'exe';
    }
    else if (osPlat == 'mac') {
        if (arch == 'x86') {
            throw '32-bit Julia is not available on macOS';
        }
        versionExt = '-mac64';
        ext = 'dmg';
    }
    else if (osPlat === 'linux') {
        versionExt = arch == 'x64' ? '-linux64' : '-linux32';
        ext = 'tar.gz';
    }
    else {
        throw `Platform ${osPlat} is not supported`;
    }
    return `julia-latest${versionExt}.${ext}`;
}
function getDownloadURL(versionInfo, version, arch) {
    return __awaiter(this, void 0, void 0, function* () {
        // nightlies
        if (version == 'nightly') {
            const baseURL = 'https://julialangnightlies-s3.julialang.org/bin';
            return `${baseURL}/${osPlat}/${arch}/${getNightlyFileName(arch)}`;
        }
        versionInfo['1.3.0-rc3'].files.forEach(file => {
            if (file.os == osPlat && file.arch == archMap[arch]) {
                return file.url;
            }
        });
        throw `Could not find ${archMap[arch]}/${version} binaries`;
    });
}
exports.getDownloadURL = getDownloadURL;
function installJulia(version, arch) {
    return __awaiter(this, void 0, void 0, function* () {
        // Download Julia
        const downloadURL = yield getDownloadURL(yield getJuliaVersionInfo(), version, arch);
        core.debug(`downloading Julia from ${downloadURL}`);
        const juliaDownloadPath = yield tc.downloadTool(downloadURL);
        // Install it
        switch (osPlat) {
            case 'linux':
                // tc.extractTar doesn't support stripping components, so we have to call tar manually
                yield exec.exec('mkdir', [`${process.env.HOME}/julia`]);
                yield exec.exec('tar', ['xf', juliaDownloadPath, '--strip-components=1', '-C', `${process.env.HOME}/julia`]);
                return `${process.env.HOME}/julia`;
            case 'win32':
                const juliaInstallationPath = path.join('C:', 'Julia');
                if (version == 'nightly' || semver.gtr(version, '1.3', { includePrerelease: true })) {
                    // The installer changed in 1.4: https://github.com/JuliaLang/julia/blob/ef0c9108b12f3ae177c51037934351ffa703b0b5/NEWS.md#build-system-changes
                    yield exec.exec('powershell', ['-Command', `Start-Process -FilePath ${juliaDownloadPath} -ArgumentList "/SILENT /dir=${juliaInstallationPath}" -NoNewWindow -Wait`]);
                }
                else {
                    yield exec.exec('powershell', ['-Command', `Start-Process -FilePath ${juliaDownloadPath} -ArgumentList "/S /D=${juliaInstallationPath}" -NoNewWindow -Wait`]);
                }
                return juliaInstallationPath;
            case 'darwin':
                yield exec.exec('hdiutil', ['attach', juliaDownloadPath]);
                yield exec.exec('mkdir', [`${process.env.HOME}/julia`]);
                yield exec.exec('/bin/bash', ['-c', `cp -a /Volumes/Julia-*/Julia-*.app/Contents/Resources/julia ${process.env.HOME}`]);
                return `${process.env.HOME}/julia`;
            default:
                throw `Platform ${osPlat} is not supported`;
        }
    });
}
exports.installJulia = installJulia;
