# Vendored code

| Folder        | What                                                     | Version                         | Licence           | Upstream |
| ------------- | -------------------------------------------------------- | ------------------------------- | ----------------- | -------- |
| `vineflower/` | Vineflower decompiler built to JavaScript with TeaVM, its sources and the glue that builds it | Vineflower 1.12.0, glue `97ce2aae`, TeaVM 0.15.0-dev-6 | Apache-2.0 and MIT | [Vineflower](https://github.com/Vineflower/vineflower), [katana-project/vf](https://github.com/katana-project/vf) |

`vineflower/BUILD.md` says how `vineflower/vf.runtime.js` is built and checked, and
`vineflower/LICENSES.md` which licence covers which part. Nothing here is loaded by the plugin
yet: it is prepared for full decompilation in a later version.
