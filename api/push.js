/* eslint-disable camelcase */
const Octokit = require('@octokit/rest');

const octokit = new Octokit({
  auth: process.env.AUTH_KEY,
});
const owner = process.env.GITHUB_OWNER;
const repo = process.env.TARGET_REPO;

const filename = file => file.split('/').pop();

module.exports = async ({ body: { commits } }, res) => {
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
    repo,
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
    repo,
    commit_sha,
  });

  // 3. Create blobs for the files that were added or modified in the push
  const mapIconSetToBlobObjects = set =>
    Promise.all(
      [...set].map(file =>
        octokit.repos.getContents({
          owner,
          repo: 'android',
          path: file,
        })
      )
    )
      .then(responses =>
        Promise.all(
          responses.map(({ data: { content } }) =>
            octokit.git.createBlob({
              owner,
              repo,
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
    repo,
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
    repo,
    tree: modifiedTree,
  });

  // 6. Create a new commit
  const {
    data: { sha: new_commit_sha },
  } = await octokit.git.createCommit({
    owner,
    repo,
    message: 'Updated icons',
    tree: new_tree_sha,
    parents: [parent_commit_sha],
  });

  // 7. Update HEAD
  const { data } = await octokit.git.updateRef({
    owner,
    repo,
    ref: 'heads/master',
    sha: new_commit_sha,
  });

  res.send(data);
};
