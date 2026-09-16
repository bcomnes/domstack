declare module 'pretty-tree' {
  function tree (node: tree.TreeNode | string): string

  namespace tree {
    interface TreeNode {
      label?: string
      nodes?: TreeNode | string | Array<TreeNode | string>
      leaf?: unknown
    }

    function plain (node: TreeNode | string): string
  }

  export = tree
}
