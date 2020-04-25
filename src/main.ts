import * as io from '@actions/io';
import * as github from '@actions/github';
import * as core from '@actions/core';
import * as semver from 'semver';
import { setupExecutable, setupTemplates, runExport, createRelease, hasExportPresets, moveExports } from './godot';
import * as path from 'path';
import * as os from 'os';
import { getRepositoryInfo } from './util';

const actionWorkingPath = path.resolve(path.join(os.homedir(), '/.local/share/godot'));
const relativeProjectPath = core.getInput('relative_project_path');
const shouldCreateRelease = core.getInput('create_release') === 'true';
const relativeProjectExportsPath = path.join(relativeProjectPath, 'exports');

async function main(): Promise<number> {
  await configCheck();

  let newReleaseVersion: semver.SemVer | undefined;
  if (shouldCreateRelease) {
    newReleaseVersion = await getAndCheckNewVersion();
    core.info(`Using release version v${newReleaseVersion.format()}`);
  }

  await setupWorkingPath();
  await core.group('Godot setup', setupDependencies);

  const exportResults = await core.group('Exporting', runExport);
  if (exportResults) {
    if (shouldCreateRelease) {
      await core.group(`Create release v${(<semver.SemVer>newReleaseVersion).format()}`, async () => {
        await createRelease(<semver.SemVer>newReleaseVersion, exportResults);
      });
    } else {
      await core.group(`Move exported files`, async () => {
        await moveExports(exportResults);
      });
    }
  }
  return 0;
}

async function configCheck(): Promise<void> {
  if (shouldCreateRelease && !process.env.GITHUB_TOKEN) {
    throw new Error('You must supply the GITHUB_TOKEN environment variable to create a release.');
  }

  if (!hasExportPresets()) {
    throw new Error(
      'No "export_presets.cfg" found. Please be sure you have defined at least 1 export from the Godot editor.',
    );
  }
}

async function getAndCheckNewVersion(): Promise<semver.SemVer> {
  const newVersion = await getNewVersion();
  if (!newVersion) {
    throw new Error(
      'Could not establish a version for the release. Please check that "base_version" is a https://semver.org/ style string.',
    );
  }
  return newVersion;
}

async function setupWorkingPath(): Promise<void> {
  await io.mkdirP(actionWorkingPath);
  core.info(`Working path created ${actionWorkingPath}`);
}

async function setupDependencies(): Promise<void> {
  await setupExecutable();
  await setupTemplates();
}

async function getNewVersion(): Promise<semver.SemVer | null | undefined> {
  const base = semver.parse(core.getInput('base_version'));

  const latestTag = await getLatestReleaseTagName();
  if (latestTag) {
    let latest = semver.parse(latestTag);
    if (latest && base) {
      if (semver.gt(base, latest)) {
        latest = base;
      } else {
        latest = latest?.inc('patch') ?? null;
      }
      return latest;
    }
  }
  return base;
}

async function getLatestReleaseTagName(): Promise<string | undefined> {
  let release;
  try {
    const repoInfo = getRepositoryInfo();
    release = await getGitHubClient().repos.getLatestRelease({
      owner: repoInfo.owner,
      repo: repoInfo.repository,
    });
  } catch (e) {
    // throws error if no release exists
    // rather than using 2x api calls to see if releases exist and get latest
    // just catch the error and log a simple message
    core.info('No latest release found');
  }

  return release?.data?.tag_name;
}

function getGitHubClient(): github.GitHub {
  const githubClient = shouldCreateRelease ? new github.GitHub(process.env.GITHUB_TOKEN ?? '') : undefined;
  if (githubClient === undefined) {
    throw new Error('No GitHub client could be created. Did you supply a GitHub token?');
  }
  return githubClient;
}

function logAndExit(error: Error): void {
  core.error(error.message);
  core.setFailed(error.message);
  process.exit(1);
}

main().catch(logAndExit);

export { actionWorkingPath, relativeProjectPath, relativeProjectExportsPath, getGitHubClient, getLatestReleaseTagName };
