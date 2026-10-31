import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const pyodideReady = loadPyodide();
const runner = String.raw`
import copy, io, json, math, sys, time, tracemalloc, contextlib
from collections import Counter, defaultdict, deque, OrderedDict
from typing import *
import collections, heapq, bisect, itertools, functools, string, re, random

class ListNode:
    def __init__(self, val=0, next=None): self.val, self.next = val, next
class TreeNode:
    def __init__(self, val=0, left=None, right=None): self.val, self.left, self.right = val, left, right

def to_ll(values):
    head = None
    for value in reversed(values): head = ListNode(value, head)
    return head

def from_ll(node):
    out, seen = [], set()
    while node is not None and id(node) not in seen and len(out) < 20000:
        seen.add(id(node)); out.append(node.val); node = node.next
    return out

def to_tree(values):
    if not values or values[0] is None: return None
    root, q, i, j = TreeNode(values[0]), [], 1, 0
    q.append(root)
    while j < len(q) and i < len(values):
        node = q[j]; j += 1
        if i < len(values) and values[i] is not None:
            node.left = TreeNode(values[i]); q.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = TreeNode(values[i]); q.append(node.right)
        i += 1
    return root

def from_tree(root):
    if root is None: return []
    out, q, i = [], [root], 0
    while i < len(q) and len(out) < 20000:
        node = q[i]; i += 1
        if node is None: out.append(None); continue
        out.append(node.val); q.extend([node.left, node.right])
    while out and out[-1] is None: out.pop()
    return out

def canonical(value):
    if isinstance(value, dict): return {k: canonical(value[k]) for k in sorted(value)}
    if isinstance(value, (list, tuple)): return [canonical(v) for v in value]
    return value

def canon_key(value): return json.dumps(canonical(value), sort_keys=True, separators=(',', ':'), default=str)

def gas_ok(gas, cost, start):
    tank = 0
    for j in range(len(gas)):
        i = (start + j) % len(gas); tank += gas[i] - cost[i]
        if tank < 0: return False
    return True

def matches(kind, args, expected, got):
    try:
        if kind == 'twoSum':
            nums, target = args
            return isinstance(got, list) and len(got) == 2 and got[0] != got[1] and all(isinstance(i, int) and 0 <= i < len(nums) for i in got) and nums[got[0]] + nums[got[1]] == target
        if kind == 'twoSumII':
            nums, target = args
            return isinstance(got, list) and len(got) == 2 and 1 <= got[0] < got[1] <= len(nums) and nums[got[0]-1] + nums[got[1]-1] == target
        if kind == 'topK':
            nums, k = args; counts = Counter(nums)
            return isinstance(got, list) and len(got) == k and len(set(got)) == k and all(v in counts for v in got) and sorted((counts[v] for v in got), reverse=True) == sorted(counts.values(), reverse=True)[:k]
        if kind == 'kClosest':
            points, k = args
            if not isinstance(got, list) or len(got) != k: return False
            pool, mine = Counter(tuple(p) for p in points), Counter(tuple(p) for p in got)
            return all(mine[p] <= pool[p] for p in mine) and sorted(x*x+y*y for x,y in got) == sorted(x*x+y*y for x,y in expected)
        if kind == 'gasStation':
            gas, cost = args
            if expected == -1: return got == -1
            return isinstance(got, int) and 0 <= got < len(gas) and gas_ok(gas, cost, got)
        if kind == 'groups':
            norm=lambda groups: sorted(sorted(''.join(sorted(word)) for word in group) for group in groups)
            return norm(expected) == norm(got)
        if kind == 'triplets':
            norm=lambda rows: sorted(sorted(row) for row in rows)
            return norm(expected) == norm(got)
        if kind == 'unorderedNested':
            return sorted(canon_key(x) for x in expected) == sorted(canon_key(x) for x in got)
        if kind == 'unorderedValues':
            return sorted(expected) == sorted(got)
        if kind == 'float': return isinstance(got, (int, float)) and math.isclose(got, expected, rel_tol=1e-6, abs_tol=1e-9)
        return canonical(expected) == canonical(got)
    except Exception: return False

def run(payload):
    sys.setrecursionlimit(10000)
    ns = {'__name__':'solution', 'ListNode':ListNode, 'TreeNode':TreeNode}
    for name in ('List','Optional','Dict','Set','Tuple','Deque','Any','Counter','defaultdict','deque','heapq','bisect','math','itertools','functools','string','re','random','cache','lru_cache','heappush','heappop','heapify'):
        if name in globals(): ns[name]=globals()[name]
    safe_out = io.StringIO()
    try:
        with contextlib.redirect_stdout(safe_out): exec(compile(payload['code'], '<solution>', 'exec'), ns)
    except BaseException as e: return {'accepted':False,'passed':0,'total':len(payload['cases']),'error':type(e).__name__+': '+str(e)[:220]}
    cls = ns.get('Solution')
    if cls is not None:
        try: solution = cls()
        except Exception as e: return {'accepted':False,'passed':0,'total':len(payload['cases']),'error':'Could not create Solution: '+str(e)[:180]}
        fn = getattr(solution, payload['method'], None)
    else: fn = ns.get(payload['method'])
    if not callable(fn): return {'accepted':False,'passed':0,'total':len(payload['cases']),'error':'Define class Solution with method '+payload['method']+'.'}
    passed, total_ms, peak_bytes, first_fail = 0, 0.0, 0, None
    for ci, case in enumerate(payload['cases']):
        raw = copy.deepcopy(case['args'])
        args = [to_ll(v) if i < len(payload['kinds']) and payload['kinds'][i]=='ll' else to_tree(v) if i < len(payload['kinds']) and payload['kinds'][i]=='tree' else v for i,v in enumerate(raw)]
        try:
            try: tracemalloc.start()
            except Exception: pass
            t0=time.perf_counter()
            with contextlib.redirect_stdout(safe_out): got=fn(*args)
            total_ms += (time.perf_counter()-t0)*1000
            try:
                _, peak=tracemalloc.get_traced_memory(); peak_bytes=max(peak_bytes,peak); tracemalloc.stop()
            except Exception: pass
            if payload['ret']=='ll': got=from_ll(got)
            elif payload['ret']=='tree': got=from_tree(got)
            elif isinstance(got, tuple): got=list(got)
            ok=matches(payload.get('checker','strict'),raw,case['expected'],got)
            if ok: passed += 1
            elif first_fail is None: first_fail={'case':ci+1,'input':raw,'expected':case['expected'],'received':got}
        except BaseException as e:
            try: tracemalloc.stop()
            except Exception: pass
            if first_fail is None: first_fail={'case':ci+1,'error':type(e).__name__+': '+str(e)[:180]}
    return {'accepted':passed==len(payload['cases']),'passed':passed,'total':len(payload['cases']),'runtime_ms':round(total_ms,4),'memory_mb':round(peak_bytes/1048576,4) if peak_bytes else None,'first_fail':first_fail}

OUTPUT = json.dumps(run(json.loads(INPUT_JSON)), separators=(',',':'), default=str)
OUTPUT
`;

self.onmessage = async (event) => {
  const { id, payload } = event.data;
  try {
    const pyodide = await pyodideReady;
    pyodide.globals.set("INPUT_JSON", JSON.stringify(payload));
    const result = await pyodide.runPythonAsync(runner);
    const output = typeof result === "string" ? result : (result && typeof result.toJs === "function" ? result.toJs() : String(result));
    if (result && typeof result.destroy === "function") result.destroy();
    self.postMessage({ id, result: JSON.parse(output) });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.message || error) });
  }
};
