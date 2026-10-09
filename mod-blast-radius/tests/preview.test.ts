// mod-blast-radius / tests/preview.test.ts, by v-amorim
// Tests path resolution, size formatting and measuring a command's targets on an in-memory disk.
import { expect, test } from 'claude-code/testing'

import { formatSize, measure, resolvePath, type Io } from '../hooks/preview'
import { classify } from '../hooks/risk'

type Node = { kind: 'file'; size: number } | { kind: 'dir' }

// An in-memory disk under C:/w, plus canned git answers by argv text.
function fake(nodes: Record<string, Node>, git: Record<string, string> = {}) {
  const ran: string[] = []
  const io: Io = {
    cwd: async () => 'C:/w',
    home: async () => 'C:/Users/me',
    run: async argv => {
      ran.push(argv.join(' '))
      const out = git[argv.join(' ')]
      return out === undefined ? { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } : { exitCode: 0, stdout: out, stderr: '' }
    },
    list: async path => {
      const prefix = `${path.replace(/\/$/, '')}/`
      const names = new Map<string, Node>()
      for (const [full, node] of Object.entries(nodes)) {
        if (!full.startsWith(prefix)) continue
        const rest = full.slice(prefix.length)
        const [head] = rest.split('/')
        names.set(head!, rest.includes('/') ? { kind: 'dir' } : node)
      }
      if (!names.size && !(path in nodes)) throw new Error('ENOENT')
      return [...names].map(([name, node]) => ({ name, kind: node.kind, size: node.kind === 'file' ? node.size : 0 }))
    },
    stat: async path => {
      const node = nodes[path] ?? (Object.keys(nodes).some(full => full.startsWith(`${path}/`)) ? ({ kind: 'dir' } as Node) : undefined)
      if (!node) throw new Error('ENOENT')
      return { kind: node.kind, size: node.kind === 'file' ? node.size : 0 }
    },
  }
  return { io, ran }
}

const TREE: Record<string, Node> = {
  'C:/w/build/a.js': { kind: 'file', size: 2048 },
  'C:/w/build/sub/b.js': { kind: 'file', size: 1024 },
  'C:/w/build/sub/c.js': { kind: 'file', size: 1024 },
  'C:/w/notes.txt': { kind: 'file', size: 10 },
  'C:/w/a.log': { kind: 'file', size: 100 },
  'C:/w/config.json': { kind: 'file', size: 100 },
  'C:/w/b.log': { kind: 'file', size: 200 },
}

test('paths resolve against the folder, ~ and Git Bash drive spelling', () => {
  expect(resolvePath('C:/w', 'C:/Users/me', 'x/../y')).toBe('C:/w/y')
  expect(resolvePath('C:/w', 'C:/Users/me', '~/z')).toBe('C:/Users/me/z')
  expect(resolvePath('C:/w', 'C:/Users/me', '/c/data/q')).toBe('C:/data/q')
  expect(resolvePath('/home/u', '/home/u', '../v')).toBe('/home/v')
  expect(formatSize(1536)).toBe('1.5 KB')
})

test('rm lists each target with counts and the total size', async () => {
  const { io } = fake(TREE)
  const report = await measure(io, classify('rm -rf build notes.txt')!)

  expect(report.summary).toBe('delete 4 files and 2 folders (4.0 KB)')
  expect(report.groups[0]!.lines).toEqual(['C:/w/build/  3 files, 2 folders, 4.0 KB', 'C:/w/notes.txt  10 B'])
})

test('a folder variable in the target is expanded before measuring; any other variable is left alone', async () => {
  const { io } = fake(TREE)
  const asked: string[] = []
  io.env = async name => {
    asked.push(name)
    return name === 'PROJ' ? 'C:/secret' : 'C:/w'
  }
  const report = await measure(io, classify('rm -r "$HOME/build"')!)
  expect(report.summary).toBe('delete 3 files and 2 folders (4.0 KB)')
  await measure(io, classify('rm -r "$PROJ/build"')!)
  expect(asked).toEqual(['HOME'])
})

test('rm expands globs and braces, and names what is missing', async () => {
  const { io } = fake(TREE)
  const globbed = await measure(io, classify('rm *.log')!)
  expect(globbed.summary).toBe('delete 2 files (300 B)')

  const braced = await measure(io, classify('rm notes.txt nope.txt')!)
  expect(braced.note).toContain('1 named path not found')

  const none = await measure(io, classify('rm nothing-here')!)
  expect(none.summary).toBe('delete nothing: no path matches')
})

test('a command that moves with cd is measured there, and a missing folder is said', async () => {
  const { io } = fake(TREE)
  expect((await measure(io, classify('cd build && rm -r sub')!)).summary).toBe('delete 2 files and 1 folder (2.0 KB)')
  const lost = await measure(io, classify('cd gone && rm -r sub')!)
  expect(lost.isUnknown).toBe(true)
  expect(lost.note).toContain('does not exist')
})

test('mv and redirect to a file that is not there are harmless, over an existing one they are held', async () => {
  const { io } = fake(TREE)
  expect((await measure(io, classify('mv notes.txt fresh.txt')!)).isHarmless).toBe(true)
  const over = await measure(io, classify('mv notes.txt a.log')!)
  expect(over.isHarmless).toBeUndefined()
  expect(over.summary).toBe('replace 1 existing path')
  expect((await measure(io, classify('echo x > new.json')!)).isHarmless).toBe(true)
  const truncated = await measure(io, classify('echo x > config.json')!)
  expect(truncated.summary).toBe('empty C:/w/config.json (100 B now)')
  expect(classify('echo x > $OUT.json')).toBe(null)
})

test('git reset --hard lists the changed files and the commits the branch leaves', async () => {
  const { io } = fake(
    {},
    {
      'git status --porcelain': ' M a.ts\nM  b.ts\n?? new.ts\n',
    },
  )
  const plain = await measure(io, classify('git reset --hard')!)
  expect(plain.summary).toBe('discard uncommitted changes in 2 files')
  expect(plain.groups[0]!.lines).toEqual([' M a.ts', 'M  b.ts'])
})

test('git commands run read-only argv: status, clean -n, log, never the risky one', async () => {
  const { io, ran } = fake(
    {},
    {
      'git status --porcelain -- .': ' M a.ts\n',
      'git clean -n -d --': 'Would remove tmp/\nWould remove x.o\n',
      'git log --oneline --no-decorate HEAD..old': 'abc1 one\nabc2 two\n',
      'git rev-parse --verify --quiet origin/main': 'deadbeef\n',
      'git log --oneline --no-decorate main..origin/main': 'f00 theirs\n',
    },
  )
  const clean = await measure(io, classify('git clean -fd')!)
  expect(clean.summary).toBe('remove 2 untracked paths')
  expect(clean.groups[0]!.lines).toEqual(['tmp/', 'x.o'])

  const push = await measure(io, classify('git push --force origin main')!)
  expect(push.summary).toBe('force-push to origin/main: drops 1 commit')

  const branch = await measure(io, classify('git branch -D old')!)
  expect(branch.summary).toBe('delete 1 branch, 2 commits not on the current branch')

  const checkout = await measure(io, classify('git checkout -- .')!)
  expect(checkout.summary).toBe('discard changes in 1 file')
  expect(ran.some(line => /reset --hard|clean -fd|checkout --|push --force|branch -D/.test(line))).toBe(false)
})

test('a failed preview is said, never thrown', async () => {
  const { io } = fake({})
  const report = await measure(io, classify('git reset --hard')!)

  expect(report.isUnknown).toBe(true)
  expect(report.summary).toContain('not a git repo')
  const boom = await measure({ ...io, cwd: async () => { throw new Error('no cwd') } }, classify('rm x')!)
  expect(boom.summary).toBe('rm (preview failed)')
})

test('sql lists its statements and custom patterns say they have no preview', async () => {
  const { io } = fake({})
  expect((await measure(io, classify('psql -c "DROP TABLE a"')!)).groups[0]!.lines).toEqual(['DROP TABLE a'])
  const custom = await measure(io, classify('terraform destroy', [{ re: /terraform/i, reason: 'r' }])!)
  expect(custom.isUnknown).toBe(true)
})
