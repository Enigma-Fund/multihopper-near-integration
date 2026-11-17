"""Compile and run real NEAR sandbox tests, only within OS network confinement."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
ROOT=Path(__file__).resolve().parent
NEAR=ROOT.parent

def main():
    if sys.platform!='darwin' or not shutil.which('sandbox-exec'):
        raise RuntimeError('Reviewed macOS local-only sandbox required; no unconfined fallback')
    spec=importlib.util.spec_from_file_location('near_native_gate',NEAR/'run.py')
    native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
    native.verify_dependencies()
    runtime=json.loads((ROOT/'RUNTIME.json').read_text())
    def verify(path,digest):
        p=Path(path)
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Missing or changed reviewed runtime: '+str(p))
    verify(runtime['sandboxBinary'],runtime['sandboxBinarySha256'])
    for rel,digest in runtime['sysrootFiles'].items():verify(Path(runtime['wasmSysroot'])/rel,digest)
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'RUSTUP_HOME':str(Path.home()/'.rustup'),
         'CARGO_HOME':str(native.CACHE),'CARGO_NET_OFFLINE':'true','NO_COLOR':'1',
         'CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS':'--cfg near --sysroot='+runtime['wasmSysroot']+' -C target-feature=-reference-types,-multivalue,-bulk-memory'}
    cargo=shutil.which('cargo');node=shutil.which('node')
    if not cargo or not node:raise RuntimeError('Reviewed Rust/Node toolchain required')
    version=subprocess.check_output([cargo,'--version'],env=env,text=True)
    # Cargo comes with the checked Rust toolchain; target library hashes pin its WASM sysroot.
    print('SANDBOX_TOOLCHAIN '+version.strip(),flush=True)
    # Controller embeds this locally compiled, immutable chamber code. Build it first.
    subprocess.run(['sandbox-exec','-f',str(NEAR/'offline.sb'),cargo,'build','--offline','--locked','--release',
        '--target','wasm32-unknown-unknown','--manifest-path',str(NEAR/'contract/Cargo.toml'),'-p','multihopper-revolver-chamber-research'],env=env,check=True,timeout=600)
    subprocess.run(['sandbox-exec','-f',str(NEAR/'offline.sb'),cargo,'build','--offline','--locked','--release',
        '--target','wasm32-unknown-unknown','--manifest-path',str(NEAR/'contract/Cargo.toml'),'--workspace'],env=env,check=True,timeout=600)
    target=NEAR/'contract/target/wasm32-unknown-unknown/release'
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(target.glob('*.wasm'))}
    if '--build-only' in sys.argv:return
    if '--chambers-only' in sys.argv:
        subprocess.run(['sandbox-exec','-f',str(ROOT/'local-only.sb'),node,str(NEAR/'chambers/test.mjs')],env={'PATH':env['PATH']},check=True,timeout=900)
        return
    if '--ordinary-only' not in sys.argv and '--swarm-only' not in sys.argv:
        subprocess.run(['sandbox-exec','-f',str(ROOT/'local-only.sb'),node,str(ROOT/'test.mjs'),'--chambers-regression'],env={'PATH':env['PATH']},check=True,timeout=900)
        path=NEAR.parent/'results/near-chambers-20261105/legacy-sandbox/SUMMARY.json'
        summary=json.loads(path.read_text());summary['runtimePins']=runtime;summary['wasmSha256']=hashes
        path.write_text(json.dumps(summary,indent=2)+'\n')
        print('METRIC '+json.dumps({'profile':'near-sandbox','passedTests':summary['passed'],'transactions':summary['transactions'],'seconds':summary['seconds'],'scope':summary['scope']}),flush=True)
    if '--swarm-only' not in sys.argv:
        subprocess.run(['sandbox-exec','-f',str(ROOT/'local-only.sb'),node,str(NEAR/'ordinary/test.mjs'),'--chambers-regression'],env={'PATH':env['PATH']},check=True,timeout=900)
        ordinary_path=NEAR.parent/'results/near-chambers-20261105/ordinary-provider/SUMMARY.json'
        ordinary=json.loads(ordinary_path.read_text());ordinary['runtimePins']=runtime;ordinary['wasmSha256']=hashes
        ordinary_path.write_text(json.dumps(ordinary,indent=2)+'\n')
        print('METRIC '+json.dumps({'profile':'near-ordinary-grant','passedTests':ordinary['passed'],'seconds':ordinary['seconds'],'scope':ordinary['scope']}),flush=True)
    if '--ordinary-only' not in sys.argv:
        subprocess.run(['sandbox-exec','-f',str(ROOT/'local-only.sb'),node,str(NEAR/'swarm/test.mjs'),'--chambers-regression'],env={'PATH':env['PATH']},check=True,timeout=900)
        path=NEAR.parent/'results/near-chambers-20261105/swarm/SUMMARY.json'
        summary=json.loads(path.read_text());summary['runtimePins']=runtime;summary['wasmSha256']=hashes
        path.write_text(json.dumps(summary,indent=2)+'\n')
        subprocess.run([sys.executable,str(NEAR/'swarm/render.py'),'--chambers-regression'],check=True)
        print('METRIC '+json.dumps({'profile':'near-swarm','passedTests':summary['passed'],'seconds':summary['seconds'],'scope':summary['scope']}),flush=True)

    if '--ordinary-only' not in sys.argv and '--swarm-only' not in sys.argv:
        subprocess.run(['sandbox-exec','-f',str(ROOT/'local-only.sb'),node,str(NEAR/'chambers/test.mjs')],env={'PATH':env['PATH']},check=True,timeout=900)
        path=NEAR.parent/'results/near-chambers-20261105/SUMMARY.json'
        summary=json.loads(path.read_text());summary['runtimePins']=runtime;path.write_text(json.dumps(summary,indent=2)+'\n')
        print('METRIC '+json.dumps({'profile':'near-revolver-chambers','passedTests':summary['passed'],'seconds':summary['seconds'],'scope':summary['scope']}),flush=True)

if __name__=='__main__':main()
