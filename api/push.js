/* eslint-disable camelcase */
const { App } = require('@octokit/app');
const OctokitREST = require('@octokit/rest');

// const owner = process.env.GITHUB_OWNER;
const targetRepo = process.env.TARGET_REPO;

const filename = file => file.split('/').pop();

module.exports = async (
  {
    body: {
      commits,
      repository: {
        name: sourceRepo,
        owner: { name: owner },
      },
    },
  },
  res
) => {
  const octokit = new OctokitREST({
    async auth() {
      /*
       * In order to authenticate as a GitHub App, we need to generate a Private Key
       * and use it to sign a JSON Web Token (jwt) and encode it.
       */
      const app = new App({
        id: process.env.APP_ID,
        privateKey: process.env.APP_PRIVATE_KEY,
      });
      const jwt = app.getSignedJsonWebToken();

      // Use authenticated app to GET an individual installation
      // TODO: error handling if app not installed
      const {
        data: { id: installationId },
      } = await new OctokitREST({
        auth: jwt,
      }).apps.getRepoInstallation({
        owner,
        repo: targetRepo,
      });

      const installationAccessToken = await app.getInstallationAccessToken({
        installationId,
      });
      return `token ${installationAccessToken}`;
    },
  });

  // consolidate added, removed, and modified icons
  const addedIcons = new Set();
  const removedIcons = new Set();
  const modifiedIcons = new Set();

  const isIcon = file => file.startsWith('app/src/main/res/drawable-nodpi/');
  // I'm doing all this nonsense to protect against a scenario where someone makes a commit with a removal and then undoes that in the next commit
  commits.forEach(({ added, removed, modified }) => {
    // if there is a file that was added in the commit,
    // add to addedIcons and remove from removedIcons
    added.forEach(file => {
      if (isIcon(file)) {
        addedIcons.add(file);
        removedIcons.delete(file);
      }
    });

    // if there is a file that was deleted in the commit,
    // remove from addedIcons and add to removedIcons
    removed.forEach(file => {
      if (isIcon(file)) {
        addedIcons.delete(file);
        removedIcons.add(file);
      }
    });

    // if there is a file that was added in the commit,
    // add to modifiedIcons
    modified.forEach(file => {
      if (isIcon(file)) {
        modifiedIcons.add(file);
      }
    });
  });

  // if no icons were updated in this push, end
  if ([addedIcons, removedIcons, modifiedIcons].every(set => !set.size))
    return res.send('No icons were affected this push');

  // 1. Get a reference to HEAD of delta-icons.github.io
  const {
    data: {
      object: { sha: commit_sha },
    },
  } = await octokit.git.getRef({
    owner,
    repo: targetRepo,
    ref: 'heads/master',
  });

  // 2. Grab the commit that HEAD points to
  const {
    data: {
      sha: parent_commit_sha,
      tree: { sha: tree_sha },
    },
  } = await octokit.git.getCommit({
    owner,
    repo: targetRepo,
    commit_sha,
  });

  // 3. Create blobs for the files that were added or modified in the push
  const mapIconSetToBlobObjects = set =>
    Promise.all(
      [...set].map(file =>
        octokit.repos.getContents({
          owner,
          repo: sourceRepo,
          path: file,
        })
      )
    )
      .then(responses =>
        Promise.all(
          responses.map(({ data: { content } }) =>
            octokit.git.createBlob({
              owner,
              repo: targetRepo,
              content,
              encoding: 'base64',
            })
          )
        )
      )
      .then(responses =>
        responses.map(({ data: { sha } }, i) => ({
          path: `icons/${filename([...set][i])}`,
          mode: '100755',
          type: 'blob',
          sha,
        }))
      );

  const addedIconsBlobObjects = await mapIconSetToBlobObjects(addedIcons);
  const modifiedIconsBlobObjects = await mapIconSetToBlobObjects(modifiedIcons);

  // 4. Get a hold of the tree that the commit points to
  const {
    data: { tree },
  } = await octokit.git.getTree({
    owner,
    repo: targetRepo,
    tree_sha,
    recursive: 1,
  });

  // 5. Create a tree containing the new/modified files (and removing the deleted ones)
  // add "added" files
  let modifiedTree = [...tree];
  modifiedTree.push(...addedIconsBlobObjects);

  // change "modified" files
  modifiedTree = modifiedTree.filter(
    ({ path }) =>
      !modifiedIcons.has(`app/src/main/res/drawable-nodpi/${filename(path)}`)
  );
  modifiedTree.push(...modifiedIconsBlobObjects);

  // remove "removed" files
  modifiedTree = modifiedTree.filter(
    ({ path }) =>
      !removedIcons.has(`app/src/main/res/drawable-nodpi/${filename(path)}`)
  );

  // remove all nodes of type "tree"
  modifiedTree = modifiedTree.filter(({ type }) => type !== 'tree');

  // POST the new tree
  const {
    data: { sha: new_tree_sha },
  } = await octokit.git.createTree({
    owner,
    repo: targetRepo,
    tree: modifiedTree,
  });

  // 6. Create a new commit
  const {
    data: { sha: new_commit_sha },
  } = await octokit.git.createCommit({
    owner,
    repo: targetRepo,
    message: 'Updated icons',
    tree: new_tree_sha,
    parents: [parent_commit_sha],
  });

  // 7. Update HEAD
  const { data } = await octokit.git.updateRef({
    owner,
    repo: targetRepo,
    ref: 'heads/master',
    sha: new_commit_sha,
  });

  res.send(data);
};
