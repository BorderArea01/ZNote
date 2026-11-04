import assert from 'node:assert/strict';
import {basename} from 'node:path';

export function releasePolicy(version){
  assert.match(version,/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/,'Use x.y.z or x.y.z-beta.n');
  const prerelease=version.includes('-beta.');
  return {version,tag:(prerelease?'android-v':'v')+version,prerelease,makeLatest:!prerelease};
}

export function validateRelease(manifest){
  const policy=releasePolicy(manifest.version);
  assert.match(manifest.commit,/^[a-f0-9]{40}$/,'Release must name its checked commit');
  assert.match(manifest.tree,/^[a-f0-9]{40}$/,'Release must name its tested source tree');
  for(const platform of ['android','windows']){
    const build=manifest.builds?.[platform];
    assert.equal(build?.version,policy.version,platform+' internal version must match release');
    assert.equal(build?.tree,manifest.tree,platform+' must use the tested source tree');
  }
  assert.ok(Number.isSafeInteger(manifest.builds.android.versionCode)&&manifest.builds.android.versionCode>manifest.builds.android.previousVersionCode,'Android install code must increase');
  assert.match(manifest.builds.android.certificateSha256,/^[a-f0-9]{64}$/);
  const names=new Set();
  for(const asset of manifest.assets){
    assert.equal(basename(asset.file),asset.name,'Asset name must match its actual file');
    assert.ok(!names.has(asset.name),'Duplicate release asset');names.add(asset.name);
    assert.match(asset.sha256,/^[a-f0-9]{64}$/);
  }
  for(const suffix of ['android.apk','win-x64.exe','source.zip'])assert.ok(names.has('ZNote-'+policy.version+'-'+suffix),'Missing '+suffix);
  return policy;
}
