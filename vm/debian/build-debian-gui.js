#!/usr/bin/env node
'use strict';
// Build the optional graphical Linux image for the desktop VM: Debian 13 (trixie) arm64 + XFCE on Xvfb, with the same
// guest agent as the Alpine image. Runs on any Linux x86_64 host without binfmt: it boots the Alpine arm64 image in
// QEMU and runs debootstrap inside it (native arm64 userland), writing the Debian root file system to a second disk.
// The Debian image boots with the same kernel + initramfs as the Alpine image (their modules are copied in).
//   node vm/debian/build-debian-gui.js <alpine-image-dir: vmlinux initramfs.gz rootfs.img> <out-dir>
// → out/rootfs-debian-xfce.img (ext4, shrunk) and .gz
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn, execFileSync } = require('child_process');
const { AgentClient } = require('../../src/main/vm/agent-client');
const [IMG, OUT] = process.argv.slice(2).map(p => path.resolve(p || ''));
if (!IMG || !OUT) { console.error('usage: build-debian-gui.js <alpine-image-dir> <out-dir>'); process.exit(2); }
const ROOT = path.join(__dirname, '..', '..');
const W = process.env.WORK || '/tmp/aib-debian-build'; fs.mkdirSync(W, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const SUITE = process.env.DEBIAN_SUITE || 'trixie', MIRROR = process.env.DEBIAN_MIRROR || 'http://deb.debian.org/debian';
const PKGS = [
  // base system
  'systemd', 'systemd-sysv', 'dbus', 'udev', 'kmod', 'iproute2', 'iputils-ping', 'ca-certificates', 'curl', 'wget', 'procps', 'psmisc', 'less', 'nano', 'sudo', 'locales', 'tzdata', 'e2fsprogs', 'openssh-client', 'file', 'unzip', 'zip', 'xz-utils', 'bzip2',
  // agent toolset
  'python3', 'python3-pip', 'python3-venv', 'python3-numpy', 'python3-scipy', 'python3-sympy', 'python3-mpmath', 'python3-pandas', 'python3-matplotlib', 'python3-pil', 'git', 'ripgrep', 'patch', 'build-essential', 'jq',
  // graphical desktop (Xvfb + XFCE) and computer-use helpers
  'xvfb', 'xauth', 'x11-utils', 'x11-xserver-utils', 'xdotool', 'dbus-x11', 'xfce4-session', 'xfwm4', 'xfdesktop4', 'xfce4-panel', 'xfce4-settings', 'xfconf', 'thunar', 'xfce4-terminal', 'xfce4-appfinder', 'mousepad', 'ristretto',
  'adwaita-icon-theme', 'elementary-xfce-icon-theme', 'fonts-dejavu-core', 'fonts-wqy-microhei', 'firefox-esr', 'at-spi2-core', 'librsvg2-common'
];
const log = fs.createWriteStream(path.join(W, 'build.log'), { flags: 'a' });
const say = (s) => { const l = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(l); log.write(l + '\n'); };

(async () => {
  say('preparing disks');
  fs.copyFileSync(path.join(IMG, 'rootfs.img'), path.join(W, 'alpine.img')); fs.truncateSync(path.join(W, 'alpine.img'), 6 * 1024 ** 3);
  const RESUME = process.env.AIB_DEB_RESUME === '1' && fs.existsSync(path.join(W, 'debian.img')); // keep a finished debootstrap
  if (!RESUME) { fs.rmSync(path.join(W, 'debian.img'), { force: true }); fs.writeFileSync(path.join(W, 'debian.img'), ''); fs.truncateSync(path.join(W, 'debian.img'), 10 * 1024 ** 3); }
  const sock = path.join(W, 'agent.sock'); try { fs.unlinkSync(sock); } catch {}
  const q = spawn('qemu-system-aarch64', ['-M', 'virt', '-cpu', 'max', '-accel', 'tcg,thread=multi', '-m', '4096', '-smp', String(Math.min(8, os.cpus().length)), '-nographic', '-monitor', 'none',
    '-kernel', path.join(IMG, 'vmlinux'), '-initrd', path.join(IMG, 'initramfs.gz'), '-append', 'console=ttyAMA0 aibroot=/dev/vda rw quiet',
    '-drive', `file=${path.join(W, 'alpine.img')},if=none,format=raw,id=a`, '-device', 'virtio-blk-pci,drive=a',
    '-drive', `file=${path.join(W, 'debian.img')},if=none,format=raw,id=d`, '-device', 'virtio-blk-pci,drive=d',
    '-netdev', 'user,id=n', '-device', 'virtio-net-pci,netdev=n', '-device', 'virtio-rng-pci',
    '-device', 'virtio-serial-pci', '-chardev', `socket,path=${sock},server=on,wait=off,id=ag`, '-device', 'virtserialport,chardev=ag,name=aib.agent'], { stdio: ['ignore', 'pipe', 'pipe'] });
  q.stdout.on('data', c => log.write(c)); q.stderr.on('data', c => log.write(c));
  const c = new AgentClient(sock); await c.connect({ timeoutMs: 300000, isAlive: () => q.exitCode === null });
  say('builder VM is up');
  const sh = async (cmd, timeout = 7200) => {
    say('$ ' + cmd.split('\n')[0].slice(0, 160));
    const { done } = c.exec(cmd, { cwd: '/', timeout }, (ev) => log.write(ev.data));
    const r = await done; if (r.code !== 0) throw new Error(`exit ${r.code}: ${cmd.slice(0, 200)}`); return r;
  };
  const put = async (p, data, mode) => { const r = await c.request('write', { path: p, b64: Buffer.from(data).toString('base64'), mode }); if (!r.ok) throw new Error(r.error); };
  try {
    await sh('for i in $(seq 1 60); do ip route | grep -q ^default && break; sleep 1; done; resize2fs /dev/vda >/dev/null 2>&1; apk add -q debootstrap perl dpkg', 1800);
    if (RESUME) { await sh('mkdir -p /mnt/deb && mount /dev/vdb /mnt/deb && test -x /mnt/deb/usr/bin/apt-get'); say('resuming after debootstrap'); }
    else {
      await sh('mkfs.ext4 -q -F -L aibroot -O ^metadata_csum_seed /dev/vdb && mkdir -p /mnt/deb && mount /dev/vdb /mnt/deb');
      await sh(`debootstrap --arch=arm64 --variant=minbase --include=ca-certificates,apt-utils ${SUITE} /mnt/deb ${MIRROR}`, 14400);
    }
    await sh('for d in proc sys dev dev/pts; do mount --bind /$d /mnt/deb/$d; done; cp /etc/resolv.conf /mnt/deb/etc/resolv.conf');
    await put('/mnt/deb/etc/apt/sources.list', `deb ${MIRROR} ${SUITE} main\ndeb ${MIRROR} ${SUITE}-updates main\ndeb http://deb.debian.org/debian-security ${SUITE}-security main\n`);
    await put('/mnt/deb/etc/dpkg/dpkg.cfg.d/01-nodoc', 'path-exclude /usr/share/doc/*\npath-include /usr/share/doc/*/copyright\npath-exclude /usr/share/man/*\npath-exclude /usr/share/info/*\npath-exclude /usr/share/locale/*\npath-include /usr/share/locale/zh_CN/*\npath-include /usr/share/locale/en*\n');
    await sh(`chroot /mnt/deb sh -c 'export DEBIAN_FRONTEND=noninteractive; for i in 1 2 3 4 5; do apt-get -o Acquire::Retries=5 update && break; sleep 20; done; apt-get -o Acquire::Retries=5 install -y --no-install-recommends ${PKGS.join(' ')}'`, 14400);
    // kernel modules of the shared (Alpine linux-virt) kernel
    await sh('K=$(ls /lib/modules | head -1); mkdir -p /mnt/deb/lib/modules && cp -a /lib/modules/$K /mnt/deb/lib/modules/ && chroot /mnt/deb depmod $K');
    // guest agent + services
    await sh('mkdir -p /mnt/deb/opt/aib /mnt/deb/root/work /mnt/deb/persist/site /mnt/deb/mnt/share /mnt/deb/persist/aib');
    await put('/mnt/deb/opt/aib/agent.py', fs.readFileSync(path.join(ROOT, 'vm/guest/agent.py')));
    await put('/mnt/deb/opt/aib/kernel.py', fs.readFileSync(path.join(ROOT, 'src/main/python/kernel.py')));
    for (const f of fs.readdirSync(path.join(__dirname, 'rootfs'), { recursive: true })) {
      const src = path.join(__dirname, 'rootfs', f); if (fs.statSync(src).isDirectory()) continue;
      await put('/mnt/deb/' + f, fs.readFileSync(src), /\/(s?bin)\//.test('/' + f) ? '755' : undefined);
    }
    await sh(`chroot /mnt/deb sh -c 'systemctl enable aib-agent.service aib-setup.service aib-desktop.service systemd-networkd.service; systemctl mask getty@tty1.service serial-getty@ttyAMA0.service systemd-timesyncd.service apt-daily.timer apt-daily-upgrade.timer e2scrub_reap.service; echo aib-linux > /etc/hostname; printf "127.0.0.1 localhost aib-linux\\n" > /etc/hosts; passwd -d root; echo "en_US.UTF-8 UTF-8" > /etc/locale.gen; echo "zh_CN.UTF-8 UTF-8" >> /etc/locale.gen; locale-gen; echo LANG=en_US.UTF-8 > /etc/default/locale; ln -sf /usr/share/zoneinfo/UTC /etc/localtime; printf "nameserver 1.1.1.1\\nnameserver 8.8.8.8\\n" > /etc/resolv.conf; printf "[global]\\nbreak-system-packages = true\\nroot-user-action = ignore\\ndisable-pip-version-check = true\\n" > /etc/pip.conf; ln -sf /mnt/share /root/share; cp -r /etc/xdg/xfce4/panel /tmp/p 2>/dev/null; mkdir -p /root/.config/xfce4/xfconf/xfce-perchannel-xml && cp /etc/xdg/xfce4/panel/default.xml /root/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml'`);
    // matplotlib font cache, then shrink
    await sh('chroot /mnt/deb env HOME=/root MPLCONFIGDIR=/persist/mpl MPLBACKEND=Agg python3 -c "import matplotlib.pyplot as plt; plt.figure()" || true');
    await sh('chroot /mnt/deb sh -c "apt-get clean; rm -rf /var/lib/apt/lists/* /var/cache/debconf/*-old /var/log/*.log /tmp/*"; for d in dev/pts dev sys proc; do umount /mnt/deb/$d; done; sync; umount /mnt/deb; e2fsck -fy /dev/vdb >/dev/null 2>&1; true');
    await sh('du -sh /mnt 2>/dev/null; sync');
  } finally {
    try { await Promise.race([c.request('exec', { cmd: 'sync; poweroff -f', timeout: 10 }), new Promise(r => setTimeout(r, 5000))]); } catch {}
    setTimeout(() => { try { q.kill('SIGKILL'); } catch {} }, 5000);
    await new Promise(r => q.once('exit', r));
  }
  say('shrinking the ext4 image');
  const img = path.join(OUT, 'rootfs-debian-xfce.img');
  fs.renameSync(path.join(W, 'debian.img'), img);
  try { execFileSync('/sbin/e2fsck', ['-fy', img], { stdio: 'ignore' }); } catch {} // exit 1 = fixed
  execFileSync('/sbin/resize2fs', ['-M', img], { stdio: 'inherit' });
  const blocks = execFileSync('/sbin/dumpe2fs', ['-h', img], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const bc = Number(/Block count:\s+(\d+)/.exec(blocks)[1]), bs = Number(/Block size:\s+(\d+)/.exec(blocks)[1]);
  const size = bc * bs + 300 * 1024 * 1024; fs.truncateSync(img, size); execFileSync('/sbin/resize2fs', [img], { stdio: 'inherit' });
  say(`image ${(size / 1048576).toFixed(0)} MB; compressing`);
  execFileSync('sh', ['-c', `gzip -6 -c '${img}' > '${img}.gz' && sha256sum '${img}.gz' > '${img}.gz.sha256' && ls -l '${OUT}'`], { stdio: 'inherit' });
  say('done');
})().catch((e) => { say('FAILED: ' + (e.stack || e)); process.exit(1); });
