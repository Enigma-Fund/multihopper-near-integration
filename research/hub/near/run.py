"""Fixed synthetic gate: offline builds, loopback-only sandbox, no live wallets."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
CACHE=Path(os.environ.get('MH_NEAR_CARGO_CACHE','/tmp/mh-near-cargo-20261104'))

def verify_dependencies(cache=CACHE):
    registry=cache/'registry/src/index.crates.io-1949cf8c6b5b557f'
    review=json.loads((ROOT/'DEPENDENCIES.json').read_text())
    if hashlib.sha256((ROOT/'contract/Cargo.lock').read_bytes()).hexdigest()!=review['lockSha256']:
        raise RuntimeError('Lockfile changed; dependency review required before execution')
    for dep in review['packages']:
        package=registry/(dep['name']+'-'+dep['version'])
        checks={'Cargo.toml':dep['manifestSha256'],**dep['executionSourceHashes']}
        for rel,expected in checks.items():
            path=package/rel
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
                raise RuntimeError('Dependency absent or changed; review before execution: '+str(path))

def main():
    verify_dependencies()
    sandbox=shutil.which('sandbox-exec')
    if not sandbox or sys.platform!='darwin':
        raise RuntimeError('This gate requires the reviewed macOS deny-network sandbox; no unconfined fallback')
    cargo=shutil.which('cargo')
    if not cargo:raise RuntimeError('Cargo required')
    rustup=Path.home()/'.rustup'
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'CARGO_HOME':str(CACHE),
         'RUSTUP_HOME':str(rustup),'CARGO_NET_OFFLINE':'true','NO_COLOR':'1','CI':'true'}
    prefix=[sandbox,'-f',str(ROOT/'offline.sb')]
    commands=[
        [cargo,'test','--offline','--locked','--manifest-path',str(ROOT/'contract/Cargo.toml'),'--features','local-harness'],
        [cargo,'build','--offline','--locked','--manifest-path',str(ROOT/'contract/Cargo.toml'),'--features','local-harness','--bin','near-policy-fixture'],
        [sys.executable,'-m','unittest','discover','-s',str(ROOT),'-p','test_*.py','-v'],
    ]
    for command in commands:
        print('LOCAL_GATE '+json.dumps(command),flush=True)
        subprocess.run(prefix+command,cwd=ROOT,env=env,check=True,timeout=900)
    subprocess.run([sys.executable,str(ROOT/'sandbox/run.py')],cwd=ROOT,env=env,check=True,timeout=1100)
    print('METRIC '+json.dumps({'profile':'near','scope':'NEAR SDK regressions, local WASM lifecycle, ordinary token transfers, grant-bound provider and Swarm jobs',
        'chains':6,'networkAccess':False,'liveSigning':False,'realAssets':False,
        'contractBinarySha256':hashlib.sha256((ROOT/'contract/target/debug/near-policy-fixture').read_bytes()).hexdigest(),
        'lockSha256':hashlib.sha256((ROOT/'contract/Cargo.lock').read_bytes()).hexdigest()}),flush=True)

if __name__=='__main__':main()
