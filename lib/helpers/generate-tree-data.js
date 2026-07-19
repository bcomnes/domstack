/**
 * @import { Results } from '../builder.js'
 * @import { DomstackManifestRecord } from '../domstack-manifest/index.js'
 */

import { join, basename, posix, sep, relative } from 'path'
import cleanDeep from 'clean-deep'

/**
 * @typedef {{
 *  label: string,
 *  nodes: TreeNode[],
 *  leaf: {
 *    [keyName: string]: string | undefined
 *  }
 * }} TreeNode
 */

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

  /** @type {TreeNode} */
  const treeStructure = {
    label: `${join(cwdDir, srcDir)} => ${join(cwdDir, destDir)}`,
    leaf: {
      globalStyle: results?.siteData?.globalStyle?.outputRelname,
      globalClient: results?.siteData?.globalClient?.outputRelname,
      serviceWorker: results?.siteData?.serviceWorker?.outputRelname,
      globalVars: results?.siteData?.globalVars?.basename,
      esbuildSettings: results?.siteData?.esbuildSettings?.basename,
      markdownItSettings: results?.siteData?.markdownItSettings?.basename,
      domstackManifestSettings: results?.siteData?.domstackManifestSettings?.basename,
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

  const templateOutputsBySource = groupOutputsBySource(
    getReportOutputs(results?.pageBuildResults).filter(output => output.kind === 'template')
  )
  for (const [sourceRelname, outputs] of templateOutputsBySource) {
    const targetNode = ensureOutputNode(treeStructure, sourceRelname)
    const sourceBasename = posix.basename(sourceRelname)

    outputs.forEach((output, index) => {
      targetNode.leaf[`${sourceBasename}${index > 0 ? `-${index}` : ''}`] = templateOutputName(output)
    })
  }

  const staticOutputs = getReportOutputs(results?.staticResults).filter(output => output.kind === 'static')
  for (const output of staticOutputs) {
    const sourceRelname = output.sourceRelname ?? output.outputRelname
    const targetNode = ensureOutputNode(treeStructure, sourceRelname)
    targetNode.leaf[posix.basename(sourceRelname)] = output.outputRelname
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
  // @ts-ignore
  return cleanDeep(treeStructure)
}

/**
 * @param {{ report?: { outputs?: DomstackManifestRecord[] } } | null | undefined} result
 * @returns {DomstackManifestRecord[]}
 */
function getReportOutputs (result) {
  return result?.report?.outputs ?? []
}

/**
 * @param {DomstackManifestRecord[]} outputs
 * @returns {Map<string, DomstackManifestRecord[]>}
 */
function groupOutputsBySource (outputs) {
  /** @type {Map<string, DomstackManifestRecord[]>} */
  const outputMap = new Map()

  for (const output of outputs) {
    const key = output.sourceRelname ?? output.outputRelname
    const existing = outputMap.get(key) ?? []
    existing.push(output)
    outputMap.set(key, existing)
  }

  return outputMap
}

/**
 * @param {DomstackManifestRecord} output
 */
function templateOutputName (output) {
  if (!output.templatePath) return output.outputRelname
  const templatePrefix = `${output.templatePath}/`
  return output.outputRelname.startsWith(templatePrefix)
    ? output.outputRelname.slice(templatePrefix.length)
    : output.outputRelname
}

/**
 * @param {{
 *   label: string,
 *   nodes: TreeNode[],
 *   leaf: { [keyName: string]: string | undefined }
 * }} treeStructure
 * @param {string} sourceRelname
 * @returns {TreeNode}
 */
function ensureOutputNode (treeStructure, sourceRelname) {
  const segments = sourceRelname.split('/')
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

  return targetNode
}
