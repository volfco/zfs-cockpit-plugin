import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { CodeBlock, CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { Form, FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Modal, ModalVariant, ModalHeader, ModalBody, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import cockpit from 'cockpit';

import { useDialogs, type ActionItem } from './actions';
import { parseKeyValues, splitList, type FieldDef } from './dialogs';
import { readSettings } from './settingsPage';
import * as svc from '../service';
import type { Dataset, SendInfo } from '../types';

const _ = cockpit.gettext;

// Helper: omit undefined values so we can spread without violating
// exactOptionalPropertyTypes (mirrors actions.tsx/dialogs.tsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defined(obj: Record<string, unknown>): any {
    const out: Record<string, unknown> = {};
    for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
}

// actions.tsx keeps its destructive-op policy helpers private; the mirrors
// below follow the exact same behavior (D6).

// Actions whose subcommand needs a newer OpenZFS are disabled with a reason.
function gated(cap: string): Partial<ActionItem> {
    return svc.hasCapability(cap)
        ? {}
        : { isDisabled: true, description: _("Requires newer OpenZFS") };
}

// ---------------------------------------------------------------------------
// Shell execution for pipes/redirects (decisions.md D8): raw send streams are
// binary and cannot pass through cockpit.spawn text streams, so send/receive
// pipelines run under `sh -c` with strict single-quote escaping. Runs go
// through svc.runShell so they land in the command log.
// ---------------------------------------------------------------------------

export function shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

// Render argv as a copy-pasteable command; flags stay bare, operands quoted.
function cmdWords(words: string[]): string {
    return words.map(w => (w.startsWith('-') ? w : shellQuote(w))).join(' ');
}

// ---------------------------------------------------------------------------
// Table dialog — small generic viewer for the parsed table fetchers
// (DiffEntry / HoldEntry / UsageEntry). Optional picker switches the fetch
// target (e.g. "diff vs which snapshot?").
// ---------------------------------------------------------------------------

interface TableDef {
    title: string;
    columns: string[];
    picker?: { label: string; options: { value: string; label: string }[] };
    fetch: (picked: string) => Promise<string[][]>;
}

function TableDialog({ def, onClose }: { def: TableDef; onClose: () => void }) {
    const [picked, setPicked] = React.useState(def.picker?.options[0]?.value ?? '');
    const [rows, setRows] = React.useState<string[][] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        if (def.picker && !picked) return;
        setBusy(true);
        setRows(null);
        setError(null);
        def.fetch(picked)
                .then(r => {
                    setRows(r);
                    setBusy(false);
                })
                .catch((e: unknown) => {
                    setError(e instanceof Error ? e.message : String(e));
                    setBusy(false);
                });
    }, [def, picked]);

    return (
        <Modal
            variant={ModalVariant.large}
            isOpen
            onClose={onClose}
            aria-label={def.title}
        >
            <ModalHeader title={def.title} />
            <ModalBody>
                {def.picker && (
                    <Form isHorizontal className="pf-v6-u-mb-md">
                        <FormGroup label={def.picker.label} fieldId="zfs-table-picker">
                            <FormSelect
                                id="zfs-table-picker"
                                value={picked}
                                onChange={(_e, v) => setPicked(v)}
                            >
                                {def.picker.options.map(o => (
                                    <FormSelectOption key={o.value} value={o.value} label={o.label} />
                                ))}
                            </FormSelect>
                        </FormGroup>
                    </Form>
                )}
                {busy && <Spinner aria-label={_("Loading")} />}
                {error && (
                    <Alert variant="danger" title={_("Command failed")} isInline>
                        <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                    </Alert>
                )}
                {rows && (
                    <div className="zfs-table-region" role="region" aria-label={def.title} tabIndex={0}>
                        <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={def.title}>
                            <caption className="pf-v6-u-screen-reader">{def.title}</caption>
                            <thead className="pf-v6-c-table__thead">
                                <tr className="pf-v6-c-table__tr">
                                    {def.columns.map(c => (
                                        <th key={c} className="pf-v6-c-table__th" scope="col">{c}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="pf-v6-c-table__tbody">
                                {rows.map((r, i) => (
                                    <tr key={i} className="pf-v6-c-table__tr">
                                        {r.map((cell, j) => (
                                            <td key={j} className="pf-v6-c-table__td" data-label={def.columns[j]}>{cell || '—'}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {rows && rows.length === 0 && <span className="pf-v6-u-color-200">{_("No entries.")}</span>}
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Send dialog — `zfs send` with dry-run preview first (D8). Execution mode
// decides the destination: preview only, a local receive pipe, or a file.
// ---------------------------------------------------------------------------

interface SendDef {
    fs: string;
    datasets: Dataset[];
    source: string;
    incremental?: string | undefined;
}

interface SendForm {
    source: string;
    incremental: string;
    intermediates: boolean;
    replicate: boolean;
    large: boolean;
    embed: boolean;
    compressed: boolean;
    props: boolean;
    raw: boolean;
    saved: boolean;
    redact: string;
    mode: 'dry' | 'pipe' | 'file';
    target: string;
    force: boolean;
    recvProps: string;
    path: string;
}

function SendDialog({ def, onClose, onSuccess }: { def: SendDef; onClose: () => void; onSuccess: () => void }) {
    const snapshots = def.datasets.filter(d => d.type === 'snapshot' && d.name.startsWith(def.fs + '@'));
    const bookmarks = def.datasets.filter(d => d.type === 'bookmark' && d.name.startsWith(def.fs + '#'));
    const [f, setF] = React.useState<SendForm>({
        source: def.source || snapshots[0]?.name || '',
        incremental: def.incremental ?? '',
        intermediates: false,
        replicate: false,
        large: false,
        embed: false,
        compressed: false,
        props: false,
        raw: false,
        saved: false,
        redact: '',
        mode: 'dry',
        target: '',
        force: false,
        recvProps: '',
        path: '',
    });
    const set = (patch: Partial<SendForm>) => setF(prev => ({ ...prev, ...patch }));
    const [preview, setPreview] = React.useState<SendInfo | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<string | null>(null);
    const [typed, setTyped] = React.useState('');

    const buildArgs = (): string[] => {
        const args: string[] = [];
        if (f.replicate) args.push('-R');
        if (f.incremental) args.push(f.intermediates ? '-I' : '-i', f.incremental);
        if (f.large) args.push('-L');
        if (f.embed) args.push('-e');
        if (f.compressed) args.push('-c');
        if (f.raw) args.push('-w');
        if (f.props) args.push('-p');
        if (f.saved) args.push('--saved');
        if (f.redact.trim()) args.push('--redact', f.redact.trim());
        if (f.source) args.push(f.source);
        return args;
    };

    const composeCommand = (): string => {
        const sendCmd = cmdWords(['zfs', 'send', ...buildArgs()]);
        if (f.mode === 'file') return `${sendCmd} > ${shellQuote(f.path)}`;
        const recv = ['zfs', 'receive'];
        if (f.force) recv.push('-F');
        for (const kv of splitList(f.recvProps)) recv.push('-o', kv);
        if (f.target) recv.push(f.target);
        return `${sendCmd} | ${cmdWords(recv)}`;
    };

    const doPreview = async () => {
        setBusy(true);
        setError(null);
        try {
            setPreview(await svc.sendDryRun(buildArgs()));
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const doRun = async () => {
        setBusy(true);
        setError(null);
        try {
            // Mode "dry" is realized by the preview; run() executes the
            // composed shell command for pipe/file modes.
            const out = await svc.runShell(composeCommand(), _('Send ZFS stream (composed pipeline)'));
            setResult(out || _("Command completed successfully."));
            onSuccess();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    // D8 policy: force receives are destructive; typed confirm only while the
    // confirm-before-destructive setting is on.
    const typedConfirmTarget = f.target;
    const typedConfirm = f.mode === 'pipe' && f.force && readSettings().confirmDestructive;
    const canRun = Boolean(f.source) &&
        (f.mode !== 'pipe' || Boolean(f.target)) &&
        (f.mode !== 'file' || Boolean(f.path.trim())) &&
        (!typedConfirm || typed === typedConfirmTarget);

    return (
        <Modal
            variant={ModalVariant.large}
            isOpen
            onClose={() => { if (!busy) onClose(); }}
            title={cockpit.format(_("Send stream from $0"), def.fs)}
        >
            {result
                ? (
                    <Stack hasGutter>
                        <StackItem><Alert variant="success" title={_("Command completed")} isInline /></StackItem>
                        {result.trim() && (
                            <StackItem>
                                <CodeBlock><CodeBlockCode>{result}</CodeBlockCode></CodeBlock>
                            </StackItem>
                        )}
                    </Stack>
                )
                : (
                    <Form isHorizontal>
                        {error && (
                            <Alert variant="danger" title={_("Command failed")} isInline>
                                <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                            </Alert>
                        )}
                        <FormGroup label={_("Source snapshot")} fieldId="zfs-send-source">
                            <FormSelect
                                id="zfs-send-source"
                                value={f.source}
                                onChange={(_e, v) => set({ source: v })}
                            >
                                <FormSelectOption value="" label="—" />
                                {snapshots.map(s => (
                                    <FormSelectOption key={s.name} value={s.name} label={s.name} />
                                ))}
                            </FormSelect>
                        </FormGroup>
                        <FormGroup label={_("Incremental base")} fieldId="zfs-send-inc">
                            <FormSelect
                                id="zfs-send-inc"
                                value={f.incremental}
                                onChange={(_e, v) => set({ incremental: v })}
                            >
                                <FormSelectOption value="" label={_("None (full stream)")} />
                                {[...snapshots, ...bookmarks].map(s => (
                                    <FormSelectOption key={s.name} value={s.name} label={s.name} />
                                ))}
                            </FormSelect>
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Send only the differences since this snapshot or bookmark (-i).")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>
                        {f.incremental && (
                            <FormGroup label={_("Intermediates")} fieldId="zfs-send-int">
                                <Switch
                                    id="zfs-send-int"
                                    isChecked={f.intermediates}
                                    onChange={(_e, v) => set({ intermediates: v })}
                                    label={_("Include intermediate snapshots (-I)")}
                                />
                            </FormGroup>
                        )}
                        <FormGroup label={_("Options")} fieldId="zfs-send-opts">
                            <Stack hasGutter>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-replicate"
                                        isChecked={f.replicate}
                                        onChange={(_e, v) => set({ replicate: v })}
                                        label={_("Replication stream, with descendants (-R)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-large"
                                        isChecked={f.large}
                                        onChange={(_e, v) => set({ large: v })}
                                        label={_("Large blocks (-L)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-embed"
                                        isChecked={f.embed}
                                        onChange={(_e, v) => set({ embed: v })}
                                        label={_("Embedded data (-e)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-compressed"
                                        isChecked={f.compressed}
                                        onChange={(_e, v) => set({ compressed: v })}
                                        label={_("Compressed stream (-c)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-props"
                                        isChecked={f.props}
                                        onChange={(_e, v) => set({ props: v })}
                                        label={_("Include properties (-p)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-raw"
                                        isChecked={f.raw}
                                        onChange={(_e, v) => set({ raw: v })}
                                        label={_("Raw encrypted stream (-w)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-send-saved"
                                        isChecked={f.saved}
                                        onChange={(_e, v) => set({ saved: v })}
                                        label={_("Saved send stream (--saved)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <TextInput
                                        id="zfs-send-redact"
                                        aria-label={_("Redact bookmark")}
                                        placeholder={_("Redact bookmark (--redact)")}
                                        value={f.redact}
                                        isDisabled={!svc.hasCapability('zfs.send-redact')}
                                        onChange={(_e, v) => set({ redact: v })}
                                    />
                                    {!svc.hasCapability('zfs.send-redact') && (
                                        <span className="pf-v6-u-color-200 pf-v6-u-font-size-sm">
                                            {_("Requires newer OpenZFS")}
                                        </span>
                                    )}
                                </StackItem>
                            </Stack>
                        </FormGroup>
                        <FormGroup label={_("Execution mode")} fieldId="zfs-send-mode">
                            <FormSelect
                                id="zfs-send-mode"
                                value={f.mode}
                                onChange={(_e, v) => set({ mode: v as SendForm['mode'] })}
                            >
                                <FormSelectOption value="dry" label={_("Dry run only (preview)")} />
                                <FormSelectOption value="pipe" label={_("Pipe to local dataset…")} />
                                <FormSelectOption value="file" label={_("Save to file…")} />
                            </FormSelect>
                        </FormGroup>
                        {f.mode === 'pipe' && (
                            <>
                                <FormGroup label={_("Target dataset")} fieldId="zfs-send-target">
                                    <TextInput
                                        id="zfs-send-target"
                                        value={f.target}
                                        onChange={(_e, v) => set({ target: v })}
                                        placeholder="pool/backup"
                                    />
                                </FormGroup>
                                <FormGroup label={_("Receive options (-o)")} fieldId="zfs-send-recvprops">
                                    <TextInput
                                        id="zfs-send-recvprops"
                                        value={f.recvProps}
                                        onChange={(_e, v) => set({ recvProps: v })}
                                        placeholder="compression=lz4,readonly=on"
                                    />
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem>{_("Comma-separated key=value pairs passed to zfs receive -o.")}</HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                </FormGroup>
                                <FormGroup label={_("Force receive (-F)")} fieldId="zfs-send-force">
                                    <Switch
                                        id="zfs-send-force"
                                        isChecked={f.force}
                                        onChange={(_e, v) => set({ force: v })}
                                        label={_("Roll back the target as needed (destructive)")}
                                    />
                                </FormGroup>
                            </>
                        )}
                        {f.mode === 'file' && (
                            <FormGroup label={_("File path")} fieldId="zfs-send-path">
                                <TextInput
                                    id="zfs-send-path"
                                    value={f.path}
                                    onChange={(_e, v) => set({ path: v })}
                                    placeholder="/var/backups/backup.zstream"
                                />
                            </FormGroup>
                        )}
                        <FormGroup label={_("Command")} fieldId="zfs-send-cmd">
                            <CodeBlock>
                                <CodeBlockCode>{composeCommand()}</CodeBlockCode>
                            </CodeBlock>
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>{_("Run the dry-run preview before executing.")}</HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>
                        {preview && (
                            <FormGroup label={_("Dry-run preview")} fieldId="zfs-send-preview">
                                <Stack>
                                    <StackItem>
                                        {cockpit.format(
                                            _("$0 send $1 → $2, estimated size $3"),
                                            preview.kind, preview.from ?? '—', preview.to, preview.size,
                                        )}
                                    </StackItem>
                                </Stack>
                            </FormGroup>
                        )}
                        {typedConfirm && (
                            <FormGroup label={cockpit.format(_("Type \"$0\" to confirm"), typedConfirmTarget)} fieldId="zfs-send-typed">
                                <TextInput id="zfs-send-typed" value={typed} onChange={(_e, v) => setTyped(v)} />
                            </FormGroup>
                        )}
                    </Form>
                )}
            <ModalFooter>
                {result
                    ? <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
                    : (
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <Button
                                    variant="secondary"
                                    onClick={doPreview}
                                    isDisabled={busy || !f.source}
                                    isLoading={busy}
                                >
                                    {_("Preview (dry run)")}
                                </Button>
                            </FlexItem>
                            {f.mode !== 'dry' && (
                                <FlexItem>
                                    <Button
                                        variant={typedConfirm ? 'danger' : 'primary'}
                                        onClick={doRun}
                                        isDisabled={busy || !canRun || !preview}
                                        isLoading={busy}
                                    >
                                        {f.mode === 'pipe' ? _("Run pipeline") : _("Save stream")}
                                    </Button>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Button variant="link" onClick={onClose} isDisabled={busy}>
                                    {_("Cancel")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    )}
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Receive dialog — `zfs receive` from a file, a resume token, or a manually
// composed remote ssh pipe (D8). The composed command is always shown.
// ---------------------------------------------------------------------------

interface ReceiveDef {
    defaultTarget: string;
}

interface ReceiveForm {
    target: string;
    source: 'file' | 'token' | 'manual';
    path: string;
    token: string;
    remote: string;
    abort: boolean;
    force: boolean;
    rollback: boolean;
    nomount: boolean;
    partial: boolean;
    verbose: boolean;
    options: string;
    exclude: string;
}

function ReceiveDialog({ def, onClose, onSuccess }: { def: ReceiveDef; onClose: () => void; onSuccess: () => void }) {
    const [f, setF] = React.useState<ReceiveForm>({
        target: def.defaultTarget,
        source: 'file',
        path: '',
        token: '',
        remote: '',
        abort: false,
        force: false,
        rollback: false,
        nomount: false,
        partial: false,
        verbose: false,
        options: '',
        exclude: '',
    });
    const set = (patch: Partial<ReceiveForm>) => setF(prev => ({ ...prev, ...patch }));
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<string | null>(null);
    const [typed, setTyped] = React.useState('');

    const composeCommand = (): string => {
        const recv = ['zfs', 'receive'];
        if (f.abort) {
            recv.push('-A', f.target);
            return cmdWords(recv);
        }
        if (f.force || f.rollback) recv.push('-F');
        if (f.nomount) recv.push('-u');
        if (f.partial) recv.push('-s');
        if (f.verbose) recv.push('-v');
        for (const kv of splitList(f.options)) recv.push('-o', kv);
        for (const p of splitList(f.exclude)) recv.push('-x', p);
        if (f.target) recv.push(f.target);
        const recvCmd = cmdWords(recv);
        if (f.source === 'token') return `zfs send -t ${shellQuote(f.token)} | ${recvCmd}`;
        if (f.source === 'manual') return `${f.remote || '…'} | ${recvCmd}`;
        return `${recvCmd} < ${shellQuote(f.path)}`;
    };

    const typedConfirm = readSettings().confirmDestructive;
    const canRun = Boolean(f.target) &&
        (f.abort || (f.source === 'file' ? Boolean(f.path.trim()) : f.source === 'token' ? Boolean(f.token.trim()) : false)) &&
        (!typedConfirm || typed === f.target);

    const doRun = async () => {
        setBusy(true);
        setError(null);
        try {
            const out = f.abort
                ? await svc.dsReceive({ target: f.target, abort: true })
                : await svc.runShell(composeCommand(), _('Receive ZFS stream (composed pipeline)'));
            setResult(out || _("Command completed successfully."));
            onSuccess();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            variant={ModalVariant.large}
            isOpen
            onClose={() => { if (!busy) onClose(); }}
            title={cockpit.format(_("Receive stream into $0"), f.target || def.defaultTarget)}
        >
            {result
                ? (
                    <Stack hasGutter>
                        <StackItem><Alert variant="success" title={_("Command completed")} isInline /></StackItem>
                        {result.trim() && (
                            <StackItem>
                                <CodeBlock><CodeBlockCode>{result}</CodeBlockCode></CodeBlock>
                            </StackItem>
                        )}
                    </Stack>
                )
                : (
                    <Form isHorizontal>
                        {error && (
                            <Alert variant="danger" title={_("Command failed")} isInline>
                                <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                            </Alert>
                        )}
                        <FormGroup label={_("Target dataset")} fieldId="zfs-recv-target">
                            <TextInput
                                id="zfs-recv-target"
                                value={f.target}
                                onChange={(_e, v) => set({ target: v })}
                            />
                        </FormGroup>
                        <FormGroup label={_("Source")} fieldId="zfs-recv-source">
                            <FormSelect
                                id="zfs-recv-source"
                                value={f.source}
                                onChange={(_e, v) => set({ source: v as ReceiveForm['source'] })}
                                isDisabled={f.abort}
                            >
                                <FormSelectOption value="file" label={_("Stream file on this host")} />
                                <FormSelectOption value="token" label={_("Resumable receive token (-t)")} />
                                <FormSelectOption value="manual" label={_("Pipe from remote ssh command (manual)")} />
                            </FormSelect>
                        </FormGroup>
                        {f.source === 'file' && !f.abort && (
                            <FormGroup label={_("File path")} fieldId="zfs-recv-path">
                                <TextInput
                                    id="zfs-recv-path"
                                    value={f.path}
                                    onChange={(_e, v) => set({ path: v })}
                                    placeholder="/var/backups/backup.zstream"
                                />
                            </FormGroup>
                        )}
                        {f.source === 'token' && !f.abort && (
                            <FormGroup label={_("Resume token")} fieldId="zfs-recv-token">
                                <TextInput
                                    id="zfs-recv-token"
                                    value={f.token}
                                    onChange={(_e, v) => set({ token: v })}
                                />
                            </FormGroup>
                        )}
                        {f.source === 'manual' && !f.abort && (
                            <FormGroup label={_("Remote ssh command")} fieldId="zfs-recv-remote">
                                <TextArea
                                    id="zfs-recv-remote"
                                    rows={3}
                                    value={f.remote}
                                    onChange={(_e, v) => set({ remote: v })}
                                    placeholder="ssh host zfs send pool/fs@snap"
                                />
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem>
                                            {_("Only the command is composed for the console; run it from your own terminal.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            </FormGroup>
                        )}
                        <FormGroup label={_("Options")} fieldId="zfs-recv-opts">
                            <Stack hasGutter>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-abort"
                                        isChecked={f.abort}
                                        onChange={(_e, v) => set({ abort: v })}
                                        label={_("Abort interrupted receive (-A)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-force"
                                        isChecked={f.force}
                                        isDisabled={f.abort}
                                        onChange={(_e, v) => set({ force: v })}
                                        label={_("Force: destroy out-of-snapshot data (-F)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-rollback"
                                        isChecked={f.rollback}
                                        isDisabled={f.abort}
                                        onChange={(_e, v) => set({ rollback: v })}
                                        label={_("Roll back to most recent snapshot (-F)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-nomount"
                                        isChecked={f.nomount}
                                        isDisabled={f.abort}
                                        onChange={(_e, v) => set({ nomount: v })}
                                        label={_("Do not mount (-u)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-partial"
                                        isChecked={f.partial}
                                        isDisabled={f.abort}
                                        onChange={(_e, v) => set({ partial: v })}
                                        label={_("Keep partial state for resume (-s)")}
                                    />
                                </StackItem>
                                <StackItem>
                                    <Switch
                                        id="zfs-recv-verbose"
                                        isChecked={f.verbose}
                                        isDisabled={f.abort}
                                        onChange={(_e, v) => set({ verbose: v })}
                                        label={_("Verbose output (-v)")}
                                    />
                                </StackItem>
                                {!f.abort && (
                                    <>
                                        <StackItem>
                                            <TextInput
                                                id="zfs-recv-options"
                                                aria-label={_("Set properties (-o)")}
                                                placeholder={_("Set properties (-o), comma-separated key=value")}
                                                value={f.options}
                                                onChange={(_e, v) => set({ options: v })}
                                            />
                                        </StackItem>
                                        <StackItem>
                                            <TextInput
                                                id="zfs-recv-exclude"
                                                aria-label={_("Exclude properties (-x)")}
                                                placeholder={_("Exclude properties (-x), comma-separated")}
                                                value={f.exclude}
                                                onChange={(_e, v) => set({ exclude: v })}
                                            />
                                        </StackItem>
                                    </>
                                )}
                            </Stack>
                        </FormGroup>
                        <FormGroup label={_("Command")} fieldId="zfs-recv-cmd">
                            <CodeBlock>
                                <CodeBlockCode>{composeCommand()}</CodeBlockCode>
                            </CodeBlock>
                        </FormGroup>
                        {typedConfirm && (
                            <FormGroup label={cockpit.format(_("Type \"$0\" to confirm"), f.target)} fieldId="zfs-recv-typed">
                                <TextInput id="zfs-recv-typed" value={typed} onChange={(_e, v) => setTyped(v)} />
                            </FormGroup>
                        )}
                    </Form>
                )}
            <ModalFooter>
                {result
                    ? <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
                    : (
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <Button
                                    variant="danger"
                                    onClick={doRun}
                                    isDisabled={busy || !canRun}
                                    isLoading={busy}
                                >
                                    {_("Receive")}
                                </Button>
                            </FlexItem>
                            <FlexItem>
                                <Button variant="link" onClick={onClose} isDisabled={busy}>
                                    {_("Cancel")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    )}
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Dialog state hook — useDialogs (form/confirm/output) plus the three custom
// dataset dialogs above.
// ---------------------------------------------------------------------------

export function useDsDialogs(onChanged?: () => void) {
    const base = useDialogs(onChanged);
    const [table, setTable] = React.useState<TableDef | null>(null);
    const [send, setSend] = React.useState<SendDef | null>(null);
    const [receive, setReceive] = React.useState<ReceiveDef | null>(null);

    const node = (
        <>
            {base.node}
            {table && <TableDialog def={table} onClose={() => setTable(null)} />}
            {send && (
                <SendDialog
                    def={send}
                    onClose={() => setSend(null)}
                    onSuccess={() => base.refresh()}
                />
            )}
            {receive && (
                <ReceiveDialog
                    def={receive}
                    onClose={() => setReceive(null)}
                    onSuccess={() => base.refresh()}
                />
            )}
        </>
    );

    return {
        ...base,
        node,
        openTable: (def: TableDef) => setTable(def),
        openSend: (def: SendDef) => setSend(def),
        openReceive: (def: ReceiveDef) => setReceive(def),
    };
}

export type OpenDsDialogs = ReturnType<typeof useDsDialogs>;

// Destructive-op policy mirrors (see note above).
function typedName(name: string): string | undefined {
    return readSettings().confirmDestructive ? name : undefined;
}

interface DangerDef {
    title: string;
    body: React.ReactNode;
    name: string;
    confirmLabel?: string;
    onConfirm: () => Promise<string>;
}

function destructiveConfirm(open: OpenDsDialogs, def: DangerDef): void {
    if (readSettings().confirmDestructive) {
        open.openConfirm({
            title: def.title,
            body: def.body,
            requireTyped: def.name,
            confirmVariant: 'danger',
            ...defined({ confirmLabel: def.confirmLabel }),
            onConfirm: def.onConfirm,
        });
    } else {
        open.openOutput(def.title, async () => {
            const out = await def.onConfirm();
            open.refresh();
            return out || _("Done.");
        });
    }
}

// ---------------------------------------------------------------------------
// Dataset create forms — shared by the page toolbar (no parent) and the row
// menu (child of the clicked dataset).
// ---------------------------------------------------------------------------

function propsField(): FieldDef {
    return {
        key: 'properties',
        label: _("Properties (-o)"),
        type: 'textarea',
        placeholder: 'compression=lz4\nquota=10G',
        helper: _("One key=value per line."),
    };
}

export function openCreateDataset(open: OpenDsDialogs, parent: string): void {
    open.openForm({
        title: parent ? cockpit.format(_("Create dataset in $0"), parent) : _("Create dataset"),
        fields: [
            {
                key: 'name',
                label: _("Dataset name"),
                type: 'text',
                required: true,
                placeholder: 'pool/data',
                helper: _("Full ZFS path, e.g. pool/data."),
                ...defined({ defaultValue: parent ? `${parent}/` : undefined }),
            },
            { key: 'parents', label: _("Create parents (-p)"), type: 'switch', defaultValue: true },
            { key: 'nomount', label: _("Do not mount (-u)"), type: 'switch' },
            propsField(),
        ],
        onSubmit: v => svc.dsCreate({
            name: String(v.name),
            parents: Boolean(v.parents),
            nomount: Boolean(v.nomount),
            properties: parseKeyValues(String(v.properties ?? '')),
        }),
    });
}

export function openCreateVolume(open: OpenDsDialogs, parent: string): void {
    open.openForm({
        title: parent ? cockpit.format(_("Create volume in $0"), parent) : _("Create volume"),
        fields: [
            {
                key: 'name',
                label: _("Volume name"),
                type: 'text',
                required: true,
                placeholder: 'pool/vm-disk',
                helper: _("Full ZFS path, e.g. pool/vm-disk."),
                ...defined({ defaultValue: parent ? `${parent}/` : undefined }),
            },
            {
                key: 'size',
                label: _("Volume size (-V)"),
                type: 'text',
                required: true,
                placeholder: '10G',
                helper: _("Numeric value; sizes accept suffixes like K, M, G, T, P."),
            },
            {
                key: 'volblocksize',
                label: _("Block size (-b)"),
                type: 'text',
                placeholder: '16K',
                helper: _("Power of two between 512 and 128K. Leave empty for the default."),
            },
            { key: 'sparse', label: _("Sparse volume (-s)"), type: 'switch' },
            { key: 'parents', label: _("Create parents (-p)"), type: 'switch', defaultValue: true },
            propsField(),
        ],
        onSubmit: v => svc.dsCreate({
            name: String(v.name),
            volumeSize: String(v.size),
            sparse: Boolean(v.sparse),
            parents: Boolean(v.parents),
            properties: parseKeyValues(String(v.properties ?? '')),
            ...defined({ volblocksize: String(v.volblocksize ?? '').trim() || undefined }),
        }),
    });
}

// ---------------------------------------------------------------------------
// Row action menu — grouped per the UI spec. Which groups appear depends on
// the row type: fs/volume rows get the full surface, snapshot rows get the
// snapshot subset, bookmark rows only send + destroy.
// ---------------------------------------------------------------------------

export function datasetActions(ds: Dataset, datasets: Dataset[], open: OpenDsDialogs): ActionItem[] {
    const name = ds.name;
    const isFs = ds.type === 'filesystem';
    const isVol = ds.type === 'volume';
    const isSnap = ds.type === 'snapshot';
    const isBm = ds.type === 'bookmark';
    const isFsVol = isFs || isVol;
    const fs = isSnap
        ? name.slice(0, name.indexOf('@'))
        : isBm ? name.slice(0, name.indexOf('#')) : name;
    const pool = name.split('/')[0];
    const snapshots = datasets.filter(d => d.type === 'snapshot' && d.name.startsWith(`${fs}@`));

    const items: ActionItem[] = [];

    // ---- Lifecycle ----
    if (isFsVol) {
        items.push(
            {
                id: 'create-child',
                group: _("Lifecycle"),
                label: _("Create dataset (child)…"),
                onSelect: () => openCreateDataset(open, name),
            },
            {
                id: 'create-volume',
                group: _("Lifecycle"),
                label: _("Create volume…"),
                onSelect: () => openCreateVolume(open, name),
            },
            {
                id: 'destroy',
                group: _("Lifecycle"),
                label: _("Destroy…"),
                isDanger: true,
                onSelect: () => destructiveConfirm(open, {
                    title: _("Destroy dataset"),
                    body: cockpit.format(_("This permanently destroys $0 and ALL data on it. This cannot be undone."), name),
                    name,
                    confirmLabel: _("Destroy"),
                    onConfirm: () => svc.dsDestroy({ targets: name }),
                }),
            },
            {
                id: 'destroy-recursive',
                group: _("Lifecycle"),
                label: _("Destroy recursively…"),
                isDanger: true,
                onSelect: () => destructiveConfirm(open, {
                    title: _("Destroy dataset recursively"),
                    body: cockpit.format(_("This permanently destroys $0 and ALL child datasets, snapshots and clones. This cannot be undone."), name),
                    name,
                    confirmLabel: _("Destroy recursively"),
                    onConfirm: () => svc.dsDestroy({ targets: name, recursive: true }),
                }),
            },
            {
                id: 'rename',
                group: _("Lifecycle"),
                label: _("Rename…"),
                isDanger: true,
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Rename $0"), name),
                    submitVariant: 'danger',
                    submitLabel: _("Rename"),
                    ...defined({ requireTyped: typedName(name) }),
                    fields: [
                        { key: 'target', label: _("New name"), type: 'text', required: true, defaultValue: name },
                        { key: 'force', label: _("Force (-f)"), type: 'switch' },
                        { key: 'parents', label: _("Create parents (-p)"), type: 'switch' },
                        { key: 'unmount', label: _("Unmount during rename (-u)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsRename({
                        source: name,
                        target: String(v.target),
                        force: Boolean(v.force),
                        parents: Boolean(v.parents),
                        unmount: Boolean(v.unmount),
                    }),
                }),
            },
            {
                id: 'set-property',
                group: _("Lifecycle"),
                label: _("Set property…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Set property on $0"), name),
                    fields: [
                        { key: 'property', label: _("Property"), type: 'text', required: true, placeholder: 'compression' },
                        { key: 'value', label: _("Value"), type: 'text', required: true },
                    ],
                    onSubmit: v => svc.dsSet({
                        properties: { [String(v.property)]: String(v.value) },
                        targets: name,
                    }),
                }),
            },
            {
                id: 'inherit-property',
                group: _("Lifecycle"),
                label: _("Inherit property…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Inherit property on $0"), name),
                    fields: [
                        { key: 'property', label: _("Property"), type: 'text', required: true, placeholder: 'compression' },
                    ],
                    onSubmit: v => svc.dsInherit({ property: String(v.property), targets: name }),
                }),
            },
            {
                id: 'upgrade',
                group: _("Lifecycle"),
                label: _("Upgrade dataset…"),
                onSelect: () => open.openConfirm({
                    title: _("Upgrade dataset"),
                    body: cockpit.format(_("Upgrade $0 to the latest dataset version? This cannot be undone."), name),
                    confirmVariant: 'warning',
                    confirmLabel: _("Upgrade"),
                    onConfirm: () => svc.dsUpgrade({ targets: name }),
                }),
            },
        );
    }

    // ---- Snapshots & clones ----
    if (isFsVol) {
        items.push(
            {
                id: 'snapshot',
                group: _("Snapshots & clones"),
                label: _("Snapshot…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Create snapshot of $0"), name),
                    fields: [
                        { key: 'snap', label: _("Snapshot name"), type: 'text', required: true, placeholder: 'snap1' },
                        { key: 'recursive', label: _("Include descendants (-r)"), type: 'switch' },
                        propsField(),
                    ],
                    onSubmit: v => svc.dsSnapshot({
                        snapshots: `${name}@${String(v.snap)}`,
                        recursive: Boolean(v.recursive),
                        properties: parseKeyValues(String(v.properties ?? '')),
                    }),
                }),
            },
            {
                id: 'promote',
                group: _("Snapshots & clones"),
                label: _("Promote"),
                onSelect: () => open.openConfirm({
                    title: _("Promote clone"),
                    body: cockpit.format(_("Promote clone $0? It becomes the origin of its former origin."), name),
                    confirmVariant: 'primary',
                    confirmLabel: _("Promote"),
                    onConfirm: () => svc.dsPromote({ filesystem: name }),
                }),
            },
        );
        if (isFs) {
            items.push({
                id: 'diff',
                group: _("Snapshots & clones"),
                label: _("Show diff…"),
                ...defined({
                    isDisabled: snapshots.length === 0 ? true : undefined,
                    description: snapshots.length === 0 ? _("No snapshots to compare") : undefined,
                }),
                onSelect: () => open.openTable({
                    title: cockpit.format(_("Changes in $0 since a snapshot"), name),
                    columns: [_("Change"), _("Path"), _("New path"), _("Timestamp")],
                    picker: {
                        label: _("Snapshot"),
                        options: snapshots.map(s => ({ value: s.name, label: s.name })),
                    },
                    fetch: async picked => (await svc.fetchDiff(picked))
                            .map(d => [d.change, d.path, d.newPath ?? '', d.timestamp ?? '']),
                }),
            });
        }
    }
    if (isSnap) {
        items.push(
            {
                id: 'rollback',
                group: _("Snapshots & clones"),
                label: _("Rollback…"),
                isDanger: true,
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Roll back $0 to $1"), fs, name),
                    description: _("Later snapshots and clones can be destroyed. This cannot be undone."),
                    submitVariant: 'danger',
                    submitLabel: _("Roll back"),
                    ...defined({ requireTyped: typedName(name) }),
                    fields: [
                        { key: 'recursive', label: _("Destroy intermediate snapshots (-r)"), type: 'switch' },
                        { key: 'recursiveClones', label: _("Destroy dependent clones (-R)"), type: 'switch' },
                        { key: 'force', label: _("Force (-f)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsRollback({
                        snapshot: name,
                        recursive: Boolean(v.recursive),
                        recursiveClones: Boolean(v.recursiveClones),
                        force: Boolean(v.force),
                    }),
                }),
            },
            {
                id: 'clone',
                group: _("Snapshots & clones"),
                label: _("Clone…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Clone $0"), name),
                    fields: [
                        { key: 'target', label: _("Clone name"), type: 'text', required: true, defaultValue: `${fs}-clone` },
                        { key: 'parents', label: _("Create parents (-p)"), type: 'switch' },
                        propsField(),
                    ],
                    onSubmit: v => svc.dsClone({
                        snapshot: name,
                        target: String(v.target),
                        parents: Boolean(v.parents),
                        properties: parseKeyValues(String(v.properties ?? '')),
                    }),
                }),
            },
            {
                id: 'bookmark',
                group: _("Snapshots & clones"),
                label: _("Bookmark…"),
                ...gated('zfs.bookmark'),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Create bookmark of $0"), name),
                    description: cockpit.format(_("The bookmark is created as $0#<name>."), fs),
                    fields: [
                        { key: 'tag', label: _("Bookmark name"), type: 'text', required: true, placeholder: 'bm1' },
                    ],
                    onSubmit: v => svc.dsBookmark({ source: name, bookmark: `${fs}#${String(v.tag)}` }),
                }),
            },
            {
                id: 'destroy-snapshot',
                group: _("Snapshots & clones"),
                label: _("Destroy snapshot…"),
                isDanger: true,
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Destroy snapshot $0"), name),
                    submitVariant: 'danger',
                    submitLabel: _("Destroy"),
                    ...defined({ requireTyped: typedName(name) }),
                    fields: [
                        { key: 'recursive', label: _("Destroy newer snapshots too (-r)"), type: 'switch' },
                        { key: 'defer', label: _("Defer while holds/clones exist (-d)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsDestroy({
                        targets: name,
                        recursive: Boolean(v.recursive),
                        defer: Boolean(v.defer),
                    }),
                }),
            },
            {
                id: 'diff',
                group: _("Snapshots & clones"),
                label: _("Show diff…"),
                onSelect: () => open.openTable({
                    title: cockpit.format(_("Changes in $0"), name),
                    columns: [_("Change"), _("Path"), _("New path"), _("Timestamp")],
                    fetch: async () => (await svc.fetchDiff(name))
                            .map(d => [d.change, d.path, d.newPath ?? '', d.timestamp ?? '']),
                }),
            },
            {
                id: 'holds',
                group: _("Snapshots & clones"),
                label: _("Show holds"),
                onSelect: () => open.openTable({
                    title: cockpit.format(_("Holds on $0"), name),
                    columns: [_("Snapshot"), _("Tag"), _("Held since")],
                    fetch: async () => (await svc.fetchHolds(name))
                            .map(h => [h.name, h.tag, h.timestamp]),
                }),
            },
            {
                id: 'hold',
                group: _("Snapshots & clones"),
                label: _("Hold…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Hold $0"), name),
                    fields: [
                        { key: 'tag', label: _("Tag"), type: 'text', required: true, placeholder: 'keep' },
                    ],
                    onSubmit: v => svc.dsHold({ tag: String(v.tag), snapshots: name }),
                }),
            },
            {
                id: 'release',
                group: _("Snapshots & clones"),
                label: _("Release…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Release hold on $0"), name),
                    fields: [
                        { key: 'tag', label: _("Tag"), type: 'text', required: true, placeholder: 'keep' },
                    ],
                    onSubmit: v => svc.dsRelease({ tag: String(v.tag), snapshots: name }),
                }),
            },
        );
    }

    // ---- Mount & share (filesystems only) ----
    if (isFs) {
        items.push(
            {
                id: 'mount',
                group: _("Mount & share"),
                label: _("Mount…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Mount $0"), name),
                    fields: [
                        {
                            key: 'options',
                            label: _("Mount options (-o)"),
                            type: 'text',
                            placeholder: 'noatime',
                            helper: _("Comma-separated mount options."),
                        },
                        { key: 'overlay', label: _("Overlay mount (-O)"), type: 'switch' },
                        { key: 'verbose', label: _("Verbose (-v)"), type: 'switch' },
                        { key: 'all', label: _("Mount all filesystems (-a)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsMount({
                        ...(v.all ? { all: true } : { targets: [name] }),
                        overlay: Boolean(v.overlay),
                        verbose: Boolean(v.verbose),
                        ...defined({ options: String(v.options ?? '').trim() || undefined }),
                    }),
                }),
            },
            {
                id: 'unmount',
                group: _("Mount & share"),
                label: _("Unmount…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Unmount $0"), name),
                    fields: [
                        { key: 'force', label: _("Force (-f)"), type: 'switch' },
                        { key: 'unloadKeys', label: _("Unload encryption keys (-u)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsUnmount({
                        targets: [name],
                        force: Boolean(v.force),
                        unloadKeys: Boolean(v.unloadKeys),
                    }),
                }),
            },
            {
                id: 'share',
                group: _("Mount & share"),
                label: _("Share…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Share $0"), name),
                    fields: [
                        {
                            key: 'protocol',
                            label: _("Protocol"),
                            type: 'select',
                            options: [
                                { value: 'nfs', label: 'NFS' },
                                { value: 'smb', label: 'SMB' },
                            ],
                            helper: _("Leave empty to share with the protocol of the sharenfs/sharesmb properties."),
                        },
                        { key: 'all', label: _("Share all filesystems (-a)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsShare({
                        filesystem: name,
                        all: Boolean(v.all),
                        ...defined({ protocol: String(v.protocol ?? '') || undefined }),
                    }),
                }),
            },
            {
                id: 'unshare',
                group: _("Mount & share"),
                label: _("Unshare"),
                onSelect: () => open.openConfirm({
                    title: _("Unshare"),
                    body: cockpit.format(_("Remove the NFS/SMB shares of $0?"), name),
                    confirmVariant: 'primary',
                    confirmLabel: _("Unshare"),
                    onConfirm: () => svc.dsUnshare({ target: name }),
                }),
            },
        );
    }

    // ---- Encryption ----
    if (isFsVol) {
        items.push(
            {
                id: 'load-key',
                group: _("Encryption"),
                label: _("Load key…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Load encryption key for $0"), name),
                    fields: [
                        {
                            key: 'keylocation',
                            label: _("Key location (-L)"),
                            type: 'text',
                            placeholder: 'prompt',
                            helper: _("prompt, file:///path or https://url. Leave empty for the keylocation property."),
                        },
                        { key: 'dryrun', label: _("Dry run (-n)"), type: 'switch' },
                        { key: 'recursive', label: _("Include descendants (-r)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsLoadKey({
                        targets: [name],
                        dryrun: Boolean(v.dryrun),
                        recursive: Boolean(v.recursive),
                        ...defined({ keylocation: String(v.keylocation ?? '').trim() || undefined }),
                    }),
                }),
            },
            {
                id: 'unload-key',
                group: _("Encryption"),
                label: _("Unload key…"),
                isDanger: true,
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Unload encryption key for $0"), name),
                    description: _("The dataset becomes inaccessible until its key is loaded again."),
                    submitVariant: 'danger',
                    submitLabel: _("Unload key"),
                    ...defined({ requireTyped: typedName(name) }),
                    fields: [
                        { key: 'recursive', label: _("Include descendants (-r)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsUnloadKey({
                        targets: [name],
                        recursive: Boolean(v.recursive),
                    }),
                }),
            },
            {
                id: 'change-key',
                group: _("Encryption"),
                label: _("Change key…"),
                isDanger: true,
                ...gated('zfs.change-key'),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Change encryption key for $0"), name),
                    description: _("Passphrase keys are prompted on the console; file/https key locations work non-interactively."),
                    submitVariant: 'danger',
                    submitLabel: _("Change key"),
                    ...defined({ requireTyped: typedName(name) }),
                    fields: [
                        { key: 'inherited', label: _("Inherit key from parent (-i)"), type: 'switch' },
                        { key: 'loadKey', label: _("Load the new key after changing (-l)"), type: 'switch' },
                        {
                            key: 'keyformat',
                            label: _("Key format (-o keyformat)"),
                            type: 'select',
                            options: [
                                { value: 'passphrase', label: 'passphrase' },
                                { value: 'hex', label: 'hex' },
                                { value: 'raw', label: 'raw' },
                            ],
                        },
                        {
                            key: 'keylocation',
                            label: _("Key location (-o keylocation)"),
                            type: 'text',
                            placeholder: 'file:///root/keys/fs.key',
                        },
                        {
                            key: 'pbkdf2iters',
                            label: _("PBKDF2 iterations (-o pbkdf2iters)"),
                            type: 'text',
                        },
                    ],
                    onSubmit: v => {
                        const properties: Record<string, string> = {};
                        if (v.keyformat) properties.keyformat = String(v.keyformat);
                        if (String(v.keylocation ?? '').trim()) properties.keylocation = String(v.keylocation).trim();
                        if (String(v.pbkdf2iters ?? '').trim()) properties.pbkdf2iters = String(v.pbkdf2iters).trim();
                        return svc.dsChangeKey({
                            filesystem: name,
                            inherited: Boolean(v.inherited),
                            loadKey: Boolean(v.loadKey),
                            properties,
                        });
                    },
                }),
            },
        );
    }

    // ---- Replication ----
    if (isFsVol || isSnap || isBm) {
        const sendDisabled = (isFsVol || isBm) && snapshots.length === 0;
        items.push({
            id: 'send',
            group: _("Replication"),
            label: _("Send…"),
            ...defined({
                isDisabled: sendDisabled ? true : undefined,
                description: sendDisabled ? _("No snapshots to send") : undefined,
            }),
            onSelect: () => open.openSend({
                fs,
                datasets,
                source: isSnap ? name : '',
                incremental: isBm ? name : undefined,
            }),
        });
    }
    if (isFsVol) {
        items.push({
            id: 'receive',
            group: _("Replication"),
            label: _("Receive…"),
            onSelect: () => open.openReceive({ defaultTarget: name }),
        });
    }

    // ---- Delegation ----
    if (isFsVol) {
        const permFields = (): FieldDef[] => [
            {
                key: 'entityType',
                label: _("Entity type"),
                type: 'select',
                defaultValue: 'user',
                options: [
                    { value: 'user', label: _("User (-u)") },
                    { value: 'group', label: _("Group (-g)") },
                    { value: 'everyone', label: _("Everyone (-e)") },
                ],
            },
            {
                key: 'entities',
                label: _("Users / groups"),
                type: 'text',
                helper: _("Comma-separated names."),
                visible: values => values.entityType !== 'everyone',
            },
            {
                key: 'perms',
                label: _("Permissions"),
                type: 'text',
                helper: _("Comma-separated, e.g. create,destroy,mount or @setname."),
            },
            { key: 'create', label: _("Delegation applies at create time (-c)"), type: 'switch' },
            {
                key: 'setname',
                label: _("Permission set name (-s)"),
                type: 'text',
                helper: _("Defines or references an @setname instead of direct permissions."),
            },
            { key: 'local', label: _("Local only (-l)"), type: 'switch' },
            { key: 'descendent', label: _("Apply to descendants (-d)"), type: 'switch' },
        ];
        items.push(
            {
                id: 'allow',
                group: _("Delegation"),
                label: _("Allow…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Delegate permissions on $0"), name),
                    fields: permFields(),
                    onSubmit: v => svc.dsAllow({
                        target: name,
                        user: v.entityType === 'user',
                        group: v.entityType === 'group',
                        everyone: v.entityType === 'everyone',
                        entities: splitList(String(v.entities ?? '')),
                        perms: splitList(String(v.perms ?? '')),
                        create: Boolean(v.create),
                        local: Boolean(v.local),
                        descendent: Boolean(v.descendent),
                        ...defined({ set: String(v.setname ?? '').trim() || undefined }),
                    }),
                }),
            },
            {
                id: 'unallow',
                group: _("Delegation"),
                label: _("Unallow…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Remove delegated permissions on $0"), name),
                    fields: [
                        ...permFields(),
                        { key: 'recursive', label: _("Recursive (-r)"), type: 'switch' },
                    ],
                    onSubmit: v => svc.dsUnallow({
                        target: name,
                        user: v.entityType === 'user',
                        group: v.entityType === 'group',
                        everyone: v.entityType === 'everyone',
                        entities: splitList(String(v.entities ?? '')),
                        perms: splitList(String(v.perms ?? '')),
                        create: Boolean(v.create),
                        local: Boolean(v.local),
                        descendent: Boolean(v.descendent),
                        recursive: Boolean(v.recursive),
                        ...defined({ set: String(v.setname ?? '').trim() || undefined }),
                    }),
                }),
            },
        );
    }

    // ---- Advanced ----
    const usageTable = (kind: 'userspace' | 'groupspace' | 'projectspace'): TableDef => ({
        title: cockpit.format(_("$0 for $1"), kind, name),
        columns: [_("Type"), _("Name"), _("Used"), _("Quota"), _("Objects used"), _("Object quota")],
        fetch: async () => (await svc.fetchUsage(kind, name))
                .map(u => [u.type, u.name, u.used, u.quota, u.objUsed, u.objQuota]),
    });
    if (isFsVol) {
        items.push(
            {
                id: 'userspace',
                group: _("Advanced"),
                label: _("Userspace…"),
                onSelect: () => open.openTable(usageTable('userspace')),
            },
            {
                id: 'groupspace',
                group: _("Advanced"),
                label: _("Groupspace…"),
                onSelect: () => open.openTable(usageTable('groupspace')),
            },
            {
                id: 'projectspace',
                group: _("Advanced"),
                label: _("Projectspace…"),
                onSelect: () => open.openTable(usageTable('projectspace')),
            },
            {
                id: 'wait',
                group: _("Advanced"),
                label: _("Wait…"),
                ...gated('zfs.wait'),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Wait for activity on $0"), name),
                    description: _("Blocks until the selected background activities finish."),
                    fields: [{
                        key: 'activity',
                        label: _("Activity (-t)"),
                        type: 'select',
                        options: [
                            { value: 'deleteq', label: _("Delete queue (deleteq)") },
                            { value: 'free', label: _("Free") },
                            { value: 'readonly', label: _("Read-only") },
                            { value: 'quiesce', label: _("Quiesce") },
                            { value: 'sync', label: _("Sync") },
                            { value: 'delete', label: _("Delete") },
                        ],
                        helper: _("Leave empty to wait for every activity type."),
                    }],
                    onSubmit: v => svc.dsWait({
                        filesystem: name,
                        ...defined({ activity: String(v.activity ?? '') || undefined }),
                    }),
                }),
            },
            {
                id: 'rewrite',
                group: _("Advanced"),
                label: _("Rewrite…"),
                ...gated('zfs.rewrite'),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Rewrite data of $0"), name),
                    description: _("Rewrites existing data to refresh checksums and reclaim compression."),
                    fields: [
                        {
                            key: 'paths',
                            label: _("Paths"),
                            type: 'textarea',
                            required: true,
                            defaultValue: name,
                            helper: _("One per line or comma-separated."),
                        },
                        { key: 'recursive', label: _("Recursive (-r)"), type: 'switch' },
                        { key: 'verbose', label: _("Verbose (-v)"), type: 'switch' },
                        { key: 'noCrossMounts', label: _("Do not cross mount points (-x)"), type: 'switch' },
                        { key: 'offset', label: _("Offset (-o)"), type: 'text' },
                        { key: 'length', label: _("Length (-l)"), type: 'text' },
                    ],
                    onSubmit: v => svc.dsRewrite({
                        targets: splitList(String(v.paths ?? '')),
                        recursive: Boolean(v.recursive),
                        verbose: Boolean(v.verbose),
                        noCrossMounts: Boolean(v.noCrossMounts),
                        ...defined({
                            offset: String(v.offset ?? '').trim() || undefined,
                            length: String(v.length ?? '').trim() || undefined,
                        }),
                    }),
                }),
            },
            {
                id: 'mount-options',
                group: _("Advanced"),
                label: _("Mount options…"),
                onSelect: () => open.openForm({
                    title: cockpit.format(_("Set mount options of $0"), name),
                    fields: [{
                        key: 'options',
                        label: _("Mount options (-o)"),
                        type: 'text',
                        required: true,
                        placeholder: 'noatime',
                    }],
                    onSubmit: v => svc.dsMount({ targets: [name], options: String(v.options) }),
                }),
            },
        );
    }
    if (isFs) {
        items.push({
            id: 'project',
            group: _("Advanced"),
            label: _("Project IDs…"),
            ...gated('zfs.project'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Manage project IDs on $0"), name),
                fields: [
                    {
                        key: 'mode',
                        label: _("Mode"),
                        type: 'select',
                        defaultValue: 'show',
                        options: [
                            { value: 'show', label: _("Show project IDs") },
                            { value: 'check', label: _("Check project IDs (-c)") },
                            { value: 'clear', label: _("Clear project IDs (-C)") },
                            { value: 'set', label: _("Set project ID (-p)") },
                        ],
                    },
                    {
                        key: 'id',
                        label: _("Project ID (-p)"),
                        type: 'text',
                        visible: values => values.mode === 'set',
                    },
                    { key: 'recursive', label: _("Recursive (-r)"), type: 'switch' },
                    { key: 'setInherit', label: _("Set inherited IDs (-s)"), type: 'switch' },
                ],
                onSubmit: v => svc.dsProject({
                    targets: [name],
                    mode: v.mode as 'show',
                    recursive: Boolean(v.recursive),
                    setInherit: Boolean(v.setInherit),
                    ...defined({ id: String(v.id ?? '').trim() || undefined }),
                }),
            }),
        });
    }
    if (isSnap) {
        items.push({
            id: 'redact',
            group: _("Advanced"),
            label: _("Redact…"),
            isDanger: true,
            ...gated('zfs.redact'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Redact $0"), name),
                description: _("Creates a redacted send stream that omits the data of the redaction snapshots."),
                submitVariant: 'danger',
                submitLabel: _("Redact"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [
                    {
                        key: 'bookmark',
                        label: _("Redaction bookmark"),
                        type: 'text',
                        required: true,
                        placeholder: `${fs}#redacted`,
                    },
                    {
                        key: 'redactionSnapshots',
                        label: _("Redaction snapshots"),
                        type: 'textarea',
                        required: true,
                        helper: _("One per line or comma-separated."),
                    },
                ],
                onSubmit: v => svc.dsRedact({
                    snapshot: name,
                    bookmark: String(v.bookmark),
                    redactionSnapshots: splitList(String(v.redactionSnapshots ?? '')),
                }),
            }),
        });
    }
    if (isFsVol) {
        items.push({
            id: 'program',
            group: _("Advanced"),
            label: _("Channel program…"),
            ...gated('zfs.program'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Run channel program on pool $0"), pool),
                fields: [
                    {
                        key: 'program',
                        label: _("Program file"),
                        type: 'text',
                        required: true,
                        placeholder: '/etc/zfs/zcp/example.lua',
                        helper: _("Path to the Lua channel program."),
                    },
                    {
                        key: 'args',
                        label: _("Arguments"),
                        type: 'text',
                        helper: _("Whitespace-separated arguments passed to the program."),
                    },
                    { key: 'readOnly', label: _("Read-only dry run (-n)"), type: 'switch' },
                    { key: 'instructionLimit', label: _("Instruction limit (-t)"), type: 'text' },
                    { key: 'memoryLimit', label: _("Memory limit (-m)"), type: 'text' },
                ],
                onSubmit: v => svc.dsProgram({
                    pool,
                    program: String(v.program),
                    readOnly: Boolean(v.readOnly),
                    ...defined({
                        args: String(v.args ?? '').trim()
                            ? String(v.args).trim()
                                    .split(/\s+/)
                            : undefined,
                        instructionLimit: String(v.instructionLimit ?? '').trim() || undefined,
                        memoryLimit: String(v.memoryLimit ?? '').trim() || undefined,
                    }),
                }),
            }),
        });
    }

    // ---- Bookmark rows: only send (-i from the bookmark) and destroy ----
    if (isBm) {
        items.push({
            id: 'destroy',
            group: _("Lifecycle"),
            label: _("Destroy bookmark…"),
            isDanger: true,
            onSelect: () => destructiveConfirm(open, {
                title: _("Destroy bookmark"),
                body: cockpit.format(_("Destroy bookmark $0?"), name),
                name,
                confirmLabel: _("Destroy"),
                onConfirm: () => svc.dsDestroy({ targets: name }),
            }),
        });
    }

    return items;
}
