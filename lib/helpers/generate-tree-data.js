/**
 * @import { Results } from '../builder.js'
 */

import { join, basename, sep, relative } from 'path'
import cleanDeep from 'clean-deep'

/**
 * Generates a printable tree of what domstack did
 * @param  {string} cwd     cwd of the build
 * @param  {string} src     string src path of the build
 * @param  {string} dest    string dest path of the build
 * @param  {Results} results    A big object of data I still need to define
 * @return {object}         A tree structure ready to print
 */
export function generateTreeData (cwd, src, dest, results) {
  const cwdDir = basename(cwd)
  const srcDir = basename(relative(cwd, src))
  const destDir = basename(relative(cwd, dest))

  /**
     * @typedef {{
     *  label: string,
     *  nodes: TreeNode[],
     *  leaf: {
     *    [keyName: string]: string | undefined
     *  }
     * }} TreeNode
     */
  /** @type {TreeNode} */
  const treeStructure = {
    label: `${join(cwdDir, srcDir)} => ${join(cwdDir, destDir)}`,
    leaf: {
      globalStyle: results?.siteData?.globalStyle?.outputRelname,
      globalClient: results?.siteData?.globalClient?.outputRelname,
      globalVars: results?.siteData?.globalVars?.basename,
      esbuildSettings: results?.siteData?.esbuildSettings?.basename,
      markdownItSettings: results?.siteData?.markdownItSettings?.basename,
      // rootLayout: results?.siteData?.layouts?.['root']?.basename
    },
    nodes: [],
  }

  for (const pageInfo of results?.siteData?.pages) {
    const segments = pageInfo.pageFile.relname.split(sep)
    segments.pop()

    let nodes = treeStructure.nodes
    let targetNode = treeStructure

    for (const segment of segments) {
      const findResults = nodes.find(node => segment === node.label)
      if (!findResults) {
        targetNode = { label: segment, leaf: {}, nodes: [] }
        nodes.push(targetNode)
      } else {
        targetNode = findResults
      }
      nodes = targetNode.nodes
    }

    targetNode.leaf[pageInfo.pageFile.basename] = join(pageInfo.path, pageInfo.outputName)
    if (pageInfo.pageStyle) targetNode.leaf[pageInfo.pageStyle.basename] = join(pageInfo.path, pageInfo.pageStyle.outputName ?? pageInfo.pageStyle.basename)
    if (pageInfo.clientBundle) targetNode.leaf[pageInfo.clientBundle.basename] = join(pageInfo.path, pageInfo.clientBundle.outputName ?? pageInfo.clientBundle.basename)
    if (pageInfo.pageVars) targetNode.leaf[pageInfo.pageVars.basename] = join(pageInfo.path, pageInfo.pageVars.basename)

    // Add worker files to the tree
    if (pageInfo.workers) {
      for (const workerFile of Object.values(pageInfo.workers)) {
        if (workerFile.outputRelname) {
          targetNode.leaf[workerFile.basename] = workerFile.outputRelname
        }
      }

      // Add workers.json to the tree if there are workers
      targetNode.leaf['workers.json'] = join(pageInfo.path, 'workers.json')
    }
  }

  if (results?.pageBuildResults?.report?.templates) {
    for (const templateReport of results?.pageBuildResults?.report?.templates) {
      const segments = templateReport.templateInfo.templateFile.relname.split(sep)
      segments.pop()

      let nodes = treeStructure.nodes
      let targetNode = treeStructure

      for (const segment of segments) {
        const findResults = nodes.find(node => segment === node.label)
        if (!findResults) {
          targetNode = { label: segment, leaf: {}, nodes: [] }
          nodes.push(targetNode)
        } else {
          targetNode = findResults
        }
        nodes = targetNode.nodes
      }
      if (templateReport.outputs.length > 0) {
        templateReport.outputs.forEach((output, index) => {
          targetNode.leaf[`${templateReport.templateInfo.templateFile.basename}${index > 0 ? `-${index}` : ''}`] = output
        })
      } else {
        targetNode.leaf[templateReport.templateInfo.templateFile.basename] = 'NO TEMPLATE OUTPUT'
      }
    }
  }

  for (const [layoutName, layoutInfo] of Object.entries(results?.siteData?.layouts)) {
    const segments = layoutInfo.relname.split(sep)
    segments.pop()

    let nodes = treeStructure.nodes
    let targetNode = treeStructure

    for (const segment of segments) {
      const findResults = nodes.find(node => segment === node.label)
      if (!findResults) {
        targetNode = { label: segment, leaf: {}, nodes: [] }
        nodes.push(targetNode)
      } else {
        targetNode = findResults
      }
      nodes = targetNode.nodes
    }

    targetNode.leaf[layoutInfo.basename] = layoutName
    if (layoutInfo.layoutStyle) targetNode.leaf[layoutInfo.layoutStyle.basename] = join(layoutInfo.parentName, layoutInfo.layoutStyle.outputName ?? layoutInfo.layoutStyle.basename)
    if (layoutInfo.layoutClient) targetNode.leaf[layoutInfo.layoutClient.basename] = join(layoutInfo.parentName, layoutInfo.layoutClient.outputName ?? layoutInfo.layoutClient.basename)
  }

  const staticReport = /** @type {{ copied?: Array<{ source: string, output: string }> }} */ (results?.staticResults?.report ?? {})
  if (staticReport?.copied) {
    for (const file of staticReport.copied) {
      const srcFile = relative(srcDir, file.source)
      const destFile = relative(destDir, file.output)
      const segments = srcFile.split(sep)
      segments.pop()

      let nodes = treeStructure.nodes
      let targetNode = treeStructure

      for (const segment of segments) {
        const findResults = nodes.find(node => segment === node.label)
        if (!findResults) {
          targetNode = { label: segment, leaf: {}, nodes: [] }
          nodes.push(targetNode)
        } else {
          targetNode = findResults
        }
        nodes = targetNode.nodes
      }

      targetNode.leaf[basename(srcFile)] = destFile
    }
  }
  // @ts-ignore
  return cleanDeep(treeStructure)
}
