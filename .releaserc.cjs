module.exports = {
  branches: [
    { name: 'master', prerelease: false },
    { name: 'next', prerelease: true },
  ],
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [
          { breaking: true, release: 'major' },
          { scope: 'release-skip', release: false },
          { type: 'feat', release: 'minor' },
          { type: 'build', release: 'patch' },
          { type: 'fix', release: 'patch' },
          { type: 'perf', release: 'patch' },
          { type: 'refactor', release: 'patch' },
          { type: 'revert', release: 'patch' },
          { scope: 'deps', release: 'patch' },
          { type: 'chore', release: false },
          { type: 'ci', release: false },
          { type: 'docs', release: false },
          { type: 'style', release: false },
          { type: 'test', release: false },
        ],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        writerOpts: {
          groupBy: 'type',
          commitGroupsSort: [
            'feat',
            'fix',
            'perf',
            'refactor',
            'revert',
            'docs',
            'chore',
          ],
          commitsSort: 'header',
        },
        presetConfig: {
          types: [
            { type: 'build', section: 'CI/CD', hidden: true },
            { type: 'chore', section: 'Other', hidden: false },
            { type: 'ci', section: 'CI/CD', hidden: true },
            { type: 'docs', section: 'Docs', hidden: false },
            { type: 'example', section: 'Examples', hidden: false },
            { type: 'feat', section: 'Features', hidden: false },
            { type: 'fix', section: 'Fixes', hidden: false },
            { type: 'perf', section: 'Performance', hidden: false },
            { type: 'refactor', section: 'Refactor', hidden: false },
            { type: 'revert', section: 'Reverts', hidden: false },
            { type: 'style', section: 'Style', hidden: true },
            { type: 'test', section: 'Tests', hidden: true },
          ],
        },
      },
    ],
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'docs/CHANGELOG.md',
      },
    ],
    [
      '@semantic-release/npm',
      {
        npmPublish: true,
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['docs', 'package.json', 'pnpm-lock.yaml'],
      },
    ],
    [
      '@semantic-release/github',
      {
        message:
          'chore(release): ${nextRelease.version}\n\n${nextRelease.notes}',
      },
    ],
  ],
};
