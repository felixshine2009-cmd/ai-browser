#!/usr/bin/env python3
"""AI Browser guest agent (runs as PID-1-respawned service inside the Linux VM).
Transports (all speak the same JSON-lines protocol):
  * virtio-vsock port 1024              (desktop, Apple Virtualization.framework via vfkit)
  * virtio console port named aib.agent (QEMU test harness)
  * a serial tty given with --tty        (iPad / v86: /dev/ttyS0)
Requests:  {"id":n,"op":"ping|exec|kill|read|write|list|py|pyint|pyreset", ...}
Replies:   {"id":n,"ev":"out","stream":"stdout|stderr","data":str}  (exec only, streamed)
           {"id":n,"ev":"exit","code":int,"ms":int,"truncated":bool}
           {"id":n,"ev":"result","ok":bool,...}
"""
import base64, json, os, signal, socket, subprocess, sys, threading, time

VERSION = 1
KERNEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kernel.py')
PROCS = {}          # exec id -> Popen
KERNELS = {}        # session -> Kernel
KLOCK = threading.Lock()
MAX_STREAM = 4 * 1024 * 1024


class Chan:
    def __init__(self, read_fn, write_fn):
        self.read_fn, self.write_fn, self.lock = read_fn, write_fn, threading.Lock()

    def send(self, obj):
        data = (json.dumps(obj, ensure_ascii=False) + '\n').encode('utf-8')
        with self.lock:
            view = memoryview(data)
            while view:
                n = self.write_fn(view)
                view = view[n:] if n else view

    def lines(self):
        buf = b''
        while True:
            chunk = self.read_fn(65536)
            if not chunk:
                return
            buf += chunk
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.strip().strip(b'\r')
                if line:
                    yield line


class Kernel:
    def __init__(self, session):
        env = dict(os.environ, MPLBACKEND='Agg', PYTHONUNBUFFERED='1', AIB_EXTRA_PATH='/persist/site', HOME='/root',
                   MPLCONFIGDIR='/persist/mpl', LANG='C.UTF-8', PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')
        self.p = subprocess.Popen([sys.executable, '-u', KERNEL], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, env=env, cwd='/root/work')
        self.lock = threading.Lock()
        self.ready = json.loads(self.p.stdout.readline() or b'{}')

    def run(self, req):
        with self.lock:
            self.p.stdin.write((json.dumps(req) + '\n').encode())
            self.p.stdin.flush()
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError('Python 内核已退出')
            return json.loads(line)

    def alive(self):
        return self.p.poll() is None


def kernel_for(session):
    with KLOCK:
        k = KERNELS.get(session)
        if not k or not k.alive():
            k = KERNELS[session] = Kernel(session)
        return k


def op_exec(ch, req):
    rid = req['id']
    t0 = time.time()
    env = dict(os.environ, HOME='/root', TERM='dumb', PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
               PYTHONPATH='/persist/site', MPLBACKEND='Agg', MPLCONFIGDIR='/persist/mpl', LANG='C.UTF-8')
    env.update({str(k): str(v) for k, v in (req.get('env') or {}).items()})
    cwd = req.get('cwd') or '/root/work'
    os.makedirs(cwd, exist_ok=True)
    stdin_data = req.get('stdin')
    p = subprocess.Popen(['/bin/sh', '-c', req.get('cmd') or 'true'], cwd=cwd, env=env, start_new_session=True,
                         stdin=subprocess.PIPE if stdin_data is not None else subprocess.DEVNULL,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    PROCS[rid] = p
    trunc = {'v': False}

    def pump(f, name):
        total = 0
        while True:
            chunk = os.read(f.fileno(), 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_STREAM:
                trunc['v'] = True
                continue
            ch.send({'id': rid, 'ev': 'out', 'stream': name, 'data': chunk.decode('utf-8', 'replace')})

    ts = [threading.Thread(target=pump, args=(p.stdout, 'stdout'), daemon=True),
          threading.Thread(target=pump, args=(p.stderr, 'stderr'), daemon=True)]
    for t in ts:
        t.start()
    if stdin_data is not None:
        try:
            p.stdin.write(stdin_data.encode())
            p.stdin.close()
        except Exception:
            pass
    timeout = float(req.get('timeout') or 0) or None
    timed_out = False
    try:
        code = p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_group(p)
        code = p.wait()
    for t in ts:
        t.join(2)
    PROCS.pop(rid, None)
    ch.send({'id': rid, 'ev': 'exit', 'code': code, 'ms': int((time.time() - t0) * 1000), 'truncated': trunc['v'], 'timedOut': timed_out})


def kill_group(p):
    try:
        os.killpg(p.pid, signal.SIGTERM)
    except Exception:
        pass
    for _ in range(20):
        if p.poll() is not None:
            return
        time.sleep(0.1)
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except Exception:
        pass


def info():
    u = os.uname()
    st = os.statvfs('/')
    mem = {}
    try:
        for l in open('/proc/meminfo'):
            k, v = l.split(':', 1)
            if k in ('MemTotal', 'MemAvailable'):
                mem[k] = int(v.split()[0]) * 1024
    except Exception:
        pass
    ip = ''
    try:
        ip = subprocess.run(['sh', '-c', "ip -4 -o addr show eth0 | awk '{print $4}'"], capture_output=True, text=True, timeout=3).stdout.strip()
    except Exception:
        pass
    return {'version': VERSION, 'kernel': u.release, 'machine': u.machine, 'python': sys.version.split()[0],
            'diskTotal': st.f_blocks * st.f_frsize, 'diskFree': st.f_bavail * st.f_frsize, 'memTotal': mem.get('MemTotal'),
            'memAvailable': mem.get('MemAvailable'), 'ip': ip, 'cpus': os.cpu_count()}


def handle(ch, req):
    rid, op = req.get('id'), req.get('op')
    try:
        if op == 'exec':
            return op_exec(ch, req)
        if op == 'kill':
            p = PROCS.get(req.get('target'))
            if p:
                kill_group(p)
            return ch.send({'id': rid, 'ev': 'result', 'ok': True, 'killed': bool(p)})
        if op == 'ping':
            return ch.send({'id': rid, 'ev': 'result', 'ok': True, 'info': info()})
        if op == 'read':
            path = req['path']
            mx = int(req.get('max') or 8 * 1024 * 1024)
            size = os.path.getsize(path)
            with open(path, 'rb') as f:
                data = f.read(mx)
            return ch.send({'id': rid, 'ev': 'result', 'ok': True, 'size': size, 'truncated': size > mx, 'b64': base64.b64encode(data).decode()})
        if op == 'write':
            path = req['path']
            os.makedirs(os.path.dirname(path) or '/', exist_ok=True)
            data = base64.b64decode(req.get('b64') or '')
            with open(path, 'ab' if req.get('append') else 'wb') as f:
                f.write(data)
            if req.get('mode'):
                os.chmod(path, int(str(req['mode']), 8))
            return ch.send({'id': rid, 'ev': 'result', 'ok': True, 'size': len(data)})
        if op == 'list':
            path = req.get('path') or '/root'
            rows = []
            for n in sorted(os.listdir(path))[:500]:
                p = os.path.join(path, n)
                try:
                    st = os.lstat(p)
                    rows.append({'name': n, 'dir': os.path.isdir(p), 'size': st.st_size})
                except Exception:
                    pass
            return ch.send({'id': rid, 'ev': 'result', 'ok': True, 'entries': rows})
        if op == 'py':
            k = kernel_for(req.get('session') or 'default')
            out = k.run({'id': rid, 'code': req.get('code') or '', 'workdir': req.get('workdir') or '/root/work',
                         'figdir': req.get('figdir') or '/root/work/.figures'})
            if req.get('inlineImages', True):
                imgs = []
                for p in out.get('images') or []:
                    try:
                        imgs.append({'path': p, 'b64': base64.b64encode(open(p, 'rb').read()).decode()})
                    except Exception:
                        pass
                out['imageData'] = imgs
            out.update({'id': rid, 'ev': 'result'})
            return ch.send(out)
        if op == 'pyint':
            k = KERNELS.get(req.get('session') or 'default')
            if k and k.alive():
                k.p.send_signal(signal.SIGINT)
            return ch.send({'id': rid, 'ev': 'result', 'ok': True})
        if op == 'pyreset':
            with KLOCK:
                k = KERNELS.pop(req.get('session') or 'default', None)
            if k:
                k.p.kill()
            return ch.send({'id': rid, 'ev': 'result', 'ok': True})
        if op == 'sync':
            os.sync()
            return ch.send({'id': rid, 'ev': 'result', 'ok': True})
        ch.send({'id': rid, 'ev': 'result', 'ok': False, 'error': 'unknown op: %s' % op})
    except Exception as e:
        ch.send({'id': rid, 'ev': 'result', 'ok': False, 'error': '%s: %s' % (type(e).__name__, e)})


def serve(ch, label):
    ch.send({'ev': 'ready', 'agent': VERSION, 'transport': label, 'info': info()})
    for line in ch.lines():
        try:
            req = json.loads(line)
        except Exception:
            continue
        threading.Thread(target=handle, args=(ch, req), daemon=True).start()


def serve_fd_path(path, label, raw=False):
    while True:
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY)
            if raw:
                import termios, tty
                tty.setraw(fd)
                attrs = termios.tcgetattr(fd)
                attrs[3] &= ~termios.ECHO
                termios.tcsetattr(fd, termios.TCSANOW, attrs)
            serve(Chan(lambda n: os.read(fd, n), lambda b: os.write(fd, b)), label)
        except Exception as e:
            print('agent', label, e, file=sys.stderr)
        try:
            os.close(fd)
        except Exception:
            pass
        time.sleep(0.5)


def serve_vsock(port=1024):
    try:
        s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        s.bind((socket.VMADDR_CID_ANY, port))
        s.listen(8)
    except Exception as e:
        print('vsock unavailable:', e, file=sys.stderr)
        return
    while True:
        c, _ = s.accept()
        threading.Thread(target=lambda c=c: serve(Chan(c.recv, c.send), 'vsock'), daemon=True).start()


def virtio_port(name='aib.agent'):
    base = '/sys/class/virtio-ports'
    try:
        for d in os.listdir(base):
            try:
                if open(os.path.join(base, d, 'name')).read().strip() == name:
                    return '/dev/' + d
            except Exception:
                pass
    except Exception:
        pass
    return None


def main():
    os.makedirs('/root/work', exist_ok=True)
    os.makedirs('/persist/site', exist_ok=True)
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    threads = []
    if '--tty' in sys.argv:
        tty_path = sys.argv[sys.argv.index('--tty') + 1]
        threads.append(threading.Thread(target=serve_fd_path, args=(tty_path, 'serial', True), daemon=True))
    else:
        threads.append(threading.Thread(target=serve_vsock, daemon=True))
        vp = None
        for _ in range(30):
            vp = virtio_port()
            if vp:
                break
            time.sleep(0.2)
        if vp:
            threads.append(threading.Thread(target=serve_fd_path, args=(vp, 'virtio-port'), daemon=True))
    for t in threads:
        t.start()
    while True:
        time.sleep(3600)


if __name__ == '__main__':
    main()
