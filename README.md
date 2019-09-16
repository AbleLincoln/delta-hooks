# Delta Icons Webhooks

Webhook to keep the Delta Icons website up to date with the official Android repo.

## TODO

- [ ] Migrate to GitHub actions

## Process

1. Octokit rest
2. Depoy to Now serverless
3. You have to create blobs that do not exist
   1. I thought you could just use existing SHA
4. We need App authentication
5. [storing keys in zeit](https://github.com/zeit/now/issues/749)

## Tools

- Now.sh
- Octokit REST

## Resources

- [octokit/rest.js](https://octokit.github.io/rest.js/)
- [octokit/app](https://github.com/octokit/app.js)
- [Commit a file with the GitHub API](http://www.levibotelho.com/development/commit-a-file-with-the-github-api/)
- [Git Internals - Git Objects](https://git-scm.com/book/en/v1/Git-Internals-Git-Objects#Commit-Objects)
- [Zeit Now: Serverless Functions](https://zeit.co/docs/v2/serverless-functions/introduction/)
