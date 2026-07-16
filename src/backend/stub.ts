import { NotImplementedError } from '../result.js';
import type {
  Backend,
  BackendKind,
  BootRequest,
  BootResult,
  DeployRequest,
  DeployResult,
  ObserveRequest,
  ObserveResult,
  OpContext,
  ResetRequest,
  ResetResult,
  RunRequest,
  RunResult,
  UbootFatwriteRequest,
  UbootFatwriteResult,
  UbootRunRequest,
  UbootRunResult,
} from './types.js';

const deferredByKind: Record<BackendKind, string> = {
  board: 'polimi-aos-megrez-eth0-60f.2',
  mock: 'polimi-aos-megrez-eth0-60f.3',
  stub: 'polimi-aos-megrez-eth0-60f.2',
};

export class StubBackend implements Backend {
  readonly kind: BackendKind;

  constructor(kind: BackendKind = 'stub') {
    this.kind = kind;
  }

  async open(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  async deploy(_request: DeployRequest, _context: OpContext): Promise<DeployResult> {
    throw new NotImplementedError(`deploy deferred to bead ${deferredByKind[this.kind]}`);
  }

  async boot(_request: BootRequest, _context: OpContext): Promise<BootResult> {
    throw new NotImplementedError(`boot deferred to bead ${deferredByKind[this.kind]}`);
  }

  async run(_request: RunRequest, _context: OpContext): Promise<RunResult> {
    throw new NotImplementedError(`run deferred to bead ${deferredByKind[this.kind]}`);
  }

  async ubootRun(_request: UbootRunRequest, _context: OpContext): Promise<UbootRunResult> {
    throw new NotImplementedError(`uboot_run deferred to bead ${deferredByKind[this.kind]}`);
  }

  async ubootFatwrite(_request: UbootFatwriteRequest, _context: OpContext): Promise<UbootFatwriteResult> {
    throw new NotImplementedError(`uboot_fatwrite deferred to bead ${deferredByKind[this.kind]}`);
  }

  async observe(_request: ObserveRequest, _context: OpContext): Promise<ObserveResult> {
    throw new NotImplementedError(`observe deferred to bead ${deferredByKind[this.kind]}`);
  }

  async reset(_request: ResetRequest, _context: OpContext): Promise<ResetResult> {
    throw new NotImplementedError(`reset deferred to bead ${deferredByKind[this.kind]}`);
  }
}
