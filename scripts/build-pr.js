#!/usr/bin/env node
/**
 * Build and install a PR-stamped VSIX for local testing.
 *
 * Usage:
 *   node scripts/build-pr.js --pr=4              # stable slot: morse-code-3.52.1-pr.4.vsix
 *   node scripts/build-pr.js --pr=4 --nightly    # nightly slot: morse-code-nightly-0.4.0.vsix (coexists with stable)
 *   node scripts/build-pr.js --pr=4 -y           # non-interactive
 *   node scripts/build-pr.js --pr=4 --editor=cursor
 *   node scripts/build-pr.js --pr=4 --no-install # build only, skip install
 *
 * --nightly installs into the separate morse-code-nightly extension slot so it
 * coexists with your stable morse-code build. Use this during PR testing.
 */

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")
const readline = require("readline")

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

const prArg = args.find((a) => a.startsWith("--pr="))
if (!prArg) {
	console.error(
		"Usage: node scripts/build-pr.js --pr=<number> [--nightly] [-y] [--editor=code|cursor] [--no-install]",
	)
	process.exit(1)
}

const prNumber = prArg.split("=")[1]
const isNightly = args.includes("--nightly")
const autoYes = args.includes("-y")
const noInstall = args.includes("--no-install")
const editorArg = args.find((a) => a.startsWith("--editor="))
const editor = editorArg ? editorArg.split("=")[1] : "code"

// ── Paths & metadata ──────────────────────────────────────────────────────────

const stablePkgPath = path.resolve(__dirname, "../src/package.json")
const nightlyPkgPath = path.resolve(__dirname, "../apps/vscode-nightly/package.nightly.json")

const stablePkg = JSON.parse(fs.readFileSync(stablePkgPath, "utf-8"))

let pkgPath, pkg, prVersion, vsixName, extensionId

if (isNightly) {
	const nightlyPkg = JSON.parse(fs.readFileSync(nightlyPkgPath, "utf-8"))
	pkgPath = nightlyPkgPath
	pkg = nightlyPkg
	// Use 0.<pr>.<build> so version increments clearly per PR
	prVersion = `0.${prNumber}.0`
	vsixName = `./bin/${nightlyPkg.name}-${prVersion}.vsix`
	extensionId = `${stablePkg.publisher}.${nightlyPkg.name}`
} else {
	pkgPath = stablePkgPath
	pkg = stablePkg
	const baseVersion = stablePkg.version.split("-")[0]
	prVersion = `${baseVersion}-pr.${prNumber}`
	vsixName = `./bin/${stablePkg.name}-${prVersion}.vsix`
	extensionId = `${stablePkg.publisher}.${stablePkg.name}`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function patchVersion(version) {
	const updated = { ...pkg, version }
	fs.writeFileSync(pkgPath, JSON.stringify(updated, null, "\t") + "\n")
}

function restoreVersion() {
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n")
}

function run(cmd) {
	execSync(cmd, { stdio: "inherit", shell: true })
}

// On Windows, the VS Code CLI is code.cmd not code.exe
function resolveEditor(name) {
	if (process.platform !== "win32") return name
	const { execSync: ex } = require("child_process")
	try {
		const p = ex(`where ${name}.cmd 2>nul`, { encoding: "utf8" }).trim().split("\n")[0].trim()
		if (p) return `"${p}"`
	} catch {}
	return name
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	const ask = (q) => new Promise((r) => rl.question(q, r))

	const resolvedEditor = resolveEditor(editor)
	const slot = isNightly ? "nightly (coexists with stable)" : "stable"

	console.log("\nMorse Code - PR Build Tool")
	console.log("==========================")
	console.log(`  PR:        #${prNumber}`)
	console.log(`  Slot:      ${slot}`)
	console.log(`  Version:   ${pkg.version} -> ${prVersion}`)
	console.log(`  VSIX:      ${vsixName}`)
	if (!noInstall) {
		console.log(`  Editor:    ${editor}`)
		console.log(`  Extension: ${extensionId}`)
	}
	console.log()

	if (!autoYes) {
		const answer = await ask("Continue? (y/n): ")
		if (answer.toLowerCase() !== "y") {
			console.log("Cancelled.")
			rl.close()
			return
		}
	}

	rl.close()

	console.log(`\n-> Patching version to ${prVersion}...`)
	patchVersion(prVersion)

	try {
		const buildCmd = isNightly ? "pnpm vsix:nightly" : "pnpm vsix"
		console.log(`-> Building VSIX (${buildCmd})...`)
		run(buildCmd)

		console.log(`\nBuilt: ${vsixName}`)

		if (!noInstall) {
			if (!fs.existsSync(vsixName)) {
				console.error(`\nVSIX not found at ${vsixName}`)
				process.exit(1)
			}

			console.log(`-> Installing ${vsixName}...`)
			run(`${resolvedEditor} --install-extension ${vsixName}`)

			console.log(`\nInstalled PR #${prNumber} build (${prVersion}) into ${slot} slot`)
			console.log("Restart VS Code to activate the updated extension.\n")
		}
	} finally {
		console.log(`-> Restoring version to ${pkg.version}...`)
		restoreVersion()
	}
}

main().catch((err) => {
	console.error("\nBuild failed:", err.message)
	try {
		restoreVersion()
	} catch {}
	process.exit(1)
})
