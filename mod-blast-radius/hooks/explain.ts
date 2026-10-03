// Plain-words copy for the card and the details pane, and the fitting rules that keep the card inside the band. Pure: no engine calls.
import { formatSize, type Report } from './preview'
import { classify, heredocs, type Risk, type UserRule } from './risk'

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

const NO_UNDO_RM = 'No. Deleted files skip the Recycle Bin.'
const NO_UNDO_GIT_LOSS = 'Uncommitted changes are lost for good.'

export type Plain = {
  // What happens, verb first: the heading and the Run label share its wording.
  verb: string
  // The folder or file the heading names, shortened first when the card is tight.
  subject?: string
  run: string
  does: string
  undo: string
}

type Fallback = { verb: string; run: string; does: string; undo: string }

// Checks the hook has no preview for: what they do, in words.
const BY_LABEL: Record<string, Fallback> = {
  'git stash': { verb: 'Delete stashed changes', run: 'Delete stash', does: 'Removes work you saved with git stash. No undo.', undo: 'No. Stashed work is deleted for good.' },
  'git push --delete': { verb: 'Delete a remote branch or tag', run: 'Delete remote branch', does: 'Removes a branch or tag from the remote repository.', undo: 'Only if you or someone else still has the commits.' },
  'make deploy': { verb: 'Deploy to production', run: 'Deploy to production', does: 'Puts a new version live for real users.', undo: 'Depends on the project. A rollback may be needed.' },
  'make migrate': { verb: 'Change the production database', run: 'Migrate production', does: 'Changes the production database or its data.', undo: 'Often no. Check that you have a backup.' },
  'databricks bundle destroy': { verb: 'Destroy the Databricks bundle', run: 'Destroy bundle', does: 'Removes every resource of the bundle from the environment.', undo: 'No. The resources can be rebuilt, their data cannot.' },
  'deploy to prod': { verb: 'Change production', run: 'Change production', does: 'Runs a deploy or cloud command against production.', undo: 'Depends on the command.' },
  'gcloud delete': { verb: 'Delete Google Cloud resources', run: 'Delete cloud resources', does: 'Removes buckets or services from Google Cloud.', undo: 'No, unless the resource has a backup.' },
  'az delete': { verb: 'Delete Azure resources', run: 'Delete cloud resources', does: 'Removes resources from Azure.', undo: 'No, unless the resource has a backup.' },
  'databricks delete': { verb: 'Delete Databricks secrets or objects', run: 'Delete from Databricks', does: 'Removes a secret scope or workspace objects.', undo: 'No. Secrets and objects are deleted for good.' },
  chmod: { verb: 'Change file permissions', run: 'Change permissions', does: 'Changes who can read, write or run these files.', undo: 'Yes, by setting the old permissions again, if you know them.' },
  'curl | sh': { verb: 'Run a downloaded script', run: 'Run the script', does: 'Downloads code from the internet and runs it at once.', undo: 'No. Check what the script does first.' },
  'secret read': { verb: 'Show a secret on screen', run: 'Show the secret', does: 'Prints a file that can hold passwords or keys into this chat.', undo: 'The secret is exposed. Change it if it matters.' },
  'credential read': { verb: 'Show a credential file', run: 'Show the file', does: 'Prints a file that holds access keys into this chat.', undo: 'The credentials are exposed. Change them if it matters.' },
  'mv /dev/null': { verb: 'Throw files away', run: 'Throw files away', does: 'Moves files into /dev/null, which discards them.', undo: 'No. The files are gone.' },
  'xargs rm': { verb: 'Delete files piped in from another command', run: 'Delete piped files', does: 'Deletes whatever files the earlier command prints.', undo: NO_UNDO_RM },
  rm: { verb: 'Delete files', run: 'Delete files', does: 'Removes files for good.', undo: NO_UNDO_RM },
  'rm -r': { verb: 'Delete folders', run: 'Delete folders', does: 'Removes folders and everything inside them. No undo.', undo: NO_UNDO_RM },
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

// "DROP TABLE users" becomes "Drop table users": keywords lower-cased, names kept as written.
function sqlVerb(statement: string) {
  const words = statement.split(/\s+/)
  const keyword = /^(?:DROP|TABLE|DATABASE|SCHEMA|CATALOG|VIEW|FUNCTION|VOLUME|TRUNCATE|DELETE|FROM|ALTER|DROP|COLUMN|CONSTRAINT|FEATURE|RENAME|VACUUM|IF|EXISTS)$/i
  let isLeading = true
  const out = words.map((word, index) => {
    if (isLeading && keyword.test(word)) return index === 0 ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()
    isLeading = false
    return word
  })
  return out.join(' ')
}

export function plainFor(risk: Risk, report: Report | null): Plain {
  const facts = report?.facts
  const items = facts?.items ?? []
  const hasFolder = items.some(item => item.path.endsWith('/'))
  switch (risk.kind) {
    case 'rm': {
      if (!facts || facts.files === undefined) return { ...(BY_LABEL[risk.label.startsWith('rm -r') ? 'rm -r' : 'rm'] ?? BY_LABEL.rm!) }
      const isOneFile = facts.files === 1 && items.length === 1 && !hasFolder
      const what = isOneFile ? facts.subject! : plural(facts.files, 'file')
      return {
        verb: `Delete ${what}`,
        subject: isOneFile ? undefined : facts.subject,
        run: `Delete ${what}`,
        does: hasFolder ? 'Removes the folder and everything inside it. No undo.' : isOneFile ? 'Removes the file. No undo.' : `Removes ${plural(facts.files, 'file')}. No undo.`,
        undo: NO_UNDO_RM,
      }
    }
    case 'mv': {
      const what = facts?.subject ?? 'the destination'
      return { verb: `Replace ${what}`, run: `Replace ${what}`, does: 'Moves a file over one that already exists. The old file is gone.', undo: 'No. The old file is replaced for good.' }
    }
    case 'redirect': {
      const what = facts?.subject ?? risk.targets[0] ?? 'the file'
      return { verb: `Overwrite ${what}`, run: `Overwrite ${what}`, does: "Replaces everything in the file with this command's output. No undo.", undo: 'No. The old content is lost unless git or a backup has it.' }
    }
    case 'chmod':
      return { verb: `Change permissions on ${plural(facts?.count ?? 0, 'file')}`, subject: facts?.subject, run: 'Change permissions', does: 'Changes who can read, write or run these files and everything under them.', undo: 'Yes, by setting the old permissions again, if you know them.' }
    case 'find-delete':
      return { verb: 'Delete matching files', subject: facts?.subject, run: 'Delete matching files', does: 'Deletes every file the find expression matches. Details shows the expression.', undo: NO_UNDO_RM }
    case 'git-reset': {
      const lost = facts?.count ?? 0
      const dropped = facts?.files ?? 0
      const what = lost ? `Discard ${plural(lost, 'changed file')}` : dropped ? `Move the branch back ${plural(dropped, 'commit')}` : 'Reset to the last commit'
      return { verb: what, run: what, does: `Sets files back to the last commit. ${NO_UNDO_GIT_LOSS}`, undo: NO_UNDO_GIT_LOSS }
    }
    case 'git-clean': {
      const what = facts?.count !== undefined ? `Delete ${plural(facts.count, 'untracked file')}` : 'Delete untracked files'
      return { verb: what, run: what, does: 'Deletes files git does not track. No undo.', undo: 'Untracked files are deleted for good.' }
    }
    case 'git-checkout': {
      const what = facts?.count !== undefined ? `Discard ${plural(facts.count, 'changed file')}` : 'Discard changed files'
      return { verb: what, run: what, does: 'Sets files back to the last commit. Unstaged changes are lost for good.', undo: 'Unstaged changes are lost for good.' }
    }
    case 'git-push-force': {
      const where = facts?.subject ?? 'the remote'
      const commits = facts?.count ? ` ${plural(facts.count, 'commit')} there are lost.` : ''
      return {
        verb: `Force push to ${where}`,
        run: `Force push to ${where}`,
        does: `Replaces the branch on the remote with yours.${commits}`,
        undo: "The remote's commits are replaced. Others who pulled them can recover them, you may not.",
      }
    }
    case 'git-branch-delete': {
      const what = facts?.subject ?? risk.targets.join(', ')
      return { verb: `Delete branch ${what}`, run: `Delete branch ${what}`, does: 'Removes the branch. Commits only on it become hard to reach.', undo: "Hard. The commits stay in git's reflog for a while." }
    }
    case 'sql': {
      const first = sqlVerb(risk.statements?.[0] ?? 'Run SQL')
      const many = (risk.statements?.length ?? 0) > 1
      return { verb: many ? `Run ${risk.statements!.length} destructive SQL statements` : first, run: many ? 'Run SQL' : first, does: 'Changes or removes data in the database.', undo: 'No, unless you have a backup.' }
    }
    default: {
      if (risk.source === 'rules') return { verb: risk.reason, run: 'Run anyway', does: sentence(`Matches your rule: ${risk.reason}`), undo: 'Check the command before you run it.' }
      if (risk.source === 'error') return { verb: 'Check this command', run: 'Run anyway', does: 'Blast radius could not read it, so it holds it.', undo: 'Unknown.' }
      const known = BY_LABEL[risk.label]
      if (known) return { ...known }
      return { verb: risk.reason, run: 'Run anyway', does: sentence(risk.reason), undo: 'Unknown.' }
    }
  }
}

const WHY: Record<string, string> = {
  'Recursive deletion of a root, home or parent directory': 'It deletes a root, home or parent folder.',
  'Recursive deletion of a critical project directory': 'It deletes a folder this project depends on.',
  'Recursive deletion (rm -r/rm -rf)': 'It deletes folders and everything inside them.',
  'File deletion with rm': 'It deletes files for good.',
  'Git force push or hard reset': 'It rewrites history or throws away your changes.',
}

const SOURCE: Record<NonNullable<Risk['source']> | 'blast', string> = {
  hook: 'Built-in rule (from your destructive-command hook).',
  blast: 'Built-in rule (from blast radius).',
  rules: 'Your rule, from ~/.claude/mod-blast-radius/rules.json.',
  error: 'Blast radius could not read this command, so it holds it to be safe.',
}

export const whyOf = (risk: Risk) => ({ why: risk.source === 'error' ? risk.reason : sentence(WHY[risk.reason] ?? risk.reason), source: SOURCE[risk.source ?? 'blast'] })

// Splits the command into the pieces a person reads: each simple command, quotes kept, operators dropped.
export function pieces(command: string) {
  const out: string[] = []
  let word = ''
  let quote = ''
  const flush = () => {
    if (word.trim()) out.push(word.trim())
    word = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      word += c
      if (c === quote) quote = ''
    } else if (c === "'" || c === '"') {
      quote = c
      word += c
    } else if (c === '\\' && i + 1 < command.length) {
      word += c + command[++i]
    } else if (c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) {
      // The `&` of `2>&1` or `&>log` belongs to a redirection, not between two steps.
      word += c
    } else if (c === '\n' || c === ';' || c === '|' || c === '&') {
      flush()
      while ((c === '|' || c === '&') && command[i + 1] === c) i++
    } else word += c
  }
  flush()
  return out
}

export type Segment = { text: string; risk: Risk | null; says: string; isScript?: boolean }

const SCRIPT_RUNNERS = new Set(['node', 'python', 'python3', 'ruby', 'perl', 'deno', 'bun', 'php'])

// One step per top-level piece. A risky step gets a sentence, a heredoc one line about what reads it, and the rest are shown as written.
export function segmentsOf(command: string, rules: UserRule[] = []): Segment[] {
  const { code, found } = heredocs(command)
  let at = 0
  return pieces(code).map(text => {
    const heredoc = /(?<!<)<<(?!<)/.test(text) ? found[at++] : undefined
    if (heredoc && !heredoc.isCode) {
      const name = heredoc.receiver || 'The command'
      const says = SCRIPT_RUNNERS.has(heredoc.receiver) ? `${name} runs a ${heredoc.lines}-line script` : `${name} reads ${plural(heredoc.lines, 'line')} of text`
      return { text, risk: null, says, isScript: true }
    }
    const bare = text.replace(/^(?:do|then|else)\s+/, '')
    const risk = classify(bare, rules)
    if (!risk) return { text, risk: null, says: '' }
    if (risk.kind === 'rm' && risk.targets.length) {
      const isRecursive = /^rm\s+-[a-zA-Z]*[rR]|--recursive|^rmdir/.test(bare) || risk.label.includes('-r')
      const what = risk.targets.join(', ')
      return { text, risk, says: isRecursive ? `Deletes the folder ${what} and everything in it` : `Deletes ${what}` }
    }
    const plain = plainFor(risk, null)
    return { text, risk, says: `${plain.verb}. ${plain.does}` }
  })
}

// The steps worth a row of their own, and one muted line for the harmless rest: "and 5 safe steps (cd, ls, grep…)".
export function stepsView(segments: Segment[]) {
  const shown = segments.filter(segment => segment.risk || segment.isScript)
  const safe = segments.filter(segment => !segment.risk && !segment.isScript)
  const names = [...new Set(safe.map(segment => segment.text.replace(/^(?:do|then|else)\s+/, '').split(/\s+/)[0]!).filter(Boolean))]
  const list = names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '')
  return { shown, rest: safe.length ? `and ${plural(safe.length, 'safe step')} (${list})` : '' }
}

// The full command as rows no wider than the pane, at most maxRows of them; what is left over is counted.
export function capLines(command: string, width: number, maxRows: number) {
  const rows: string[] = []
  for (const line of command.split('\n')) {
    if (line.length <= width) rows.push(line)
    else for (let at = 0; at < line.length; at += width) rows.push(line.slice(at, at + width))
  }
  return { rows: rows.slice(0, maxRows), more: Math.max(0, rows.length - maxRows) }
}

// ---- Fitting the card inside the band ----

// Keeps the first folder and the last name: ~/blast-radius-demo/drafts/ becomes ~/blast-…/drafts/.
export function midCut(path: string, width: number) {
  if (path.length <= width) return path
  const isDir = path.endsWith('/')
  const parts = path.replace(/\/$/, '').split('/')
  const tail = `${parts.pop() ?? ''}${isDir ? '/' : ''}`
  if (!parts.length) return `${tail.slice(0, Math.max(1, width - 1))}…`
  const head = parts.slice(0, parts[0] === '~' || parts[0] === '' ? 2 : 1).join('/')
  const room = width - tail.length - 3
  if (room >= 3) return `${head.length > room ? `${head.slice(0, room - 1)}…` : head}/…/${tail}`
  return `…/${tail}`.length <= width ? `…/${tail}` : `…${tail.slice(Math.max(0, tail.length - width + 1))}`
}

export const cutEnd = (text: string, width: number) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

// Words wrapped to the width, at most maxRows rows; what does not fit ends the last row with an ellipsis.
export function wrapRows(text: string, width: number, maxRows: number) {
  const rows: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      rows.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) rows.push(line)
  if (rows.length <= maxRows) return rows.map(row => cutEnd(row, width))
  const kept = rows.slice(0, maxRows)
  kept[maxRows - 1] = cutEnd(`${kept[maxRows - 1]} ${rows.slice(maxRows).join(' ')}`, width)
  return kept
}

// The heading text after the glyph: the folder name shrinks first, then goes; the counts in the verb stay.
export function fitHeading(plain: Plain, width: number) {
  const full = plain.subject ? `${plain.verb} in ${plain.subject}` : plain.verb
  if (full.length <= width) return full
  if (plain.subject) {
    const room = width - plain.verb.length - 4
    if (room >= 6) return `${plain.verb} in ${midCut(plain.subject, room)}`
  }
  return cutEnd(plain.verb, width)
}

export type CardRow = { kind: 'head' | 'does' | 'path' | 'line' | 'note'; text: string; stats?: string }

// Heading, figures, sentence, then its second row, as many as the band holds; the command stays in Details.
export function cardRows(plain: Plain, report: Report, width: number, bodyRows: number): CardRow[] {
  const wrapped = wrapRows(plain.does, width, 2)
  const facts = report.facts
  const items = facts?.items ?? []
  const candidates: { order: number; priority: number; row: CardRow }[] = [{ order: 0, priority: 0, row: { kind: 'head', text: fitHeading(plain, width - 3) } }]
  if (items.length) {
    const first = items[0]!
    const stats = items.length > 1 && facts?.files !== undefined ? `${plural(facts.files, 'file')} · ${plural(facts.folders ?? 0, 'folder')} · ${formatSize(facts.bytes ?? 0)}` : first.stats
    const more = items.length > 1 ? ` and ${items.length - 1} more` : ''
    const room = Math.max(8, width - stats.length - more.length - 3)
    candidates.push({ order: 10, priority: 1, row: { kind: 'path', text: `${midCut(first.path, room)}${more}`, stats } })
  } else if (report.isUnknown) {
    candidates.push({ order: 10, priority: 1, row: { kind: 'note', text: "Can't preview this before it runs" } })
  } else if (report.groups[0]?.lines[0]) {
    candidates.push({ order: 10, priority: 1, row: { kind: 'line', text: cutEnd(report.groups[0].lines[0], width) } })
  }
  candidates.push({ order: 1, priority: 2, row: { kind: 'does', text: wrapped[0]! } })
  if (wrapped[1]) candidates.push({ order: 2, priority: 5, row: { kind: 'does', text: wrapped[1] } })
  const chosen = [...candidates].sort((a, b) => a.priority - b.priority).slice(0, Math.max(1, bodyRows))
  return chosen.sort((a, b) => a.order - b.order).map(candidate => candidate.row)
}

// The three action labels, shortened together so the row fits: Cancel, Details and the consequence stay in that order.
export function actionLabels(plain: Plain, width: number) {
  const separators = 2 * 3
  const fixed = ' Cancel '.length + ' Details '.length + 2
  const run = cutEnd(plain.run, Math.max(8, width - fixed - separators))
  return { cancel: 'Cancel', details: 'Details', run }
}

