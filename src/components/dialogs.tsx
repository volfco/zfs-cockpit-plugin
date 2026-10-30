import React from 'react';
import { Modal, ModalVariant, ModalHeader, ModalBody, ModalFooter } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Form, FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Select, SelectList, SelectOption } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { CodeBlock, CodeBlockCode } from "@patternfly/react-core/dist/esm/components/CodeBlock/index.js";
import { DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import cockpit from 'cockpit';

import * as svc from '../service';
import type { BlockDevice, ImportablePool, Vdev } from '../types';
import { readSettings } from './settingsPage';

const _ = cockpit.gettext;

// Helper: build an object that omits keys whose values are undefined, so we
// can spread it as JSX props (or wrapper opts) without violating
// exactOptionalPropertyTypes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defined(obj: Record<string, unknown>): any {
    const out: Record<string, unknown> = {};
    for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
}

// Split a free-form device/keyword list ("one per line or comma") into argv.
export function splitList(text: string): string[] {
    return text.split(/[,\n]/)
            .map(s => s.trim())
            .filter(Boolean);
}

// Parse "key=value" lines into a property map; malformed lines are rejected
// so typos do not silently vanish from a create/set command.
export function parseKeyValues(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const eq = line.indexOf('=');
        if (eq <= 0)
            throw new Error(cockpit.format(_("Invalid property line \"$0\" (expected key=value)"), line));
        out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
}

// ---------------------------------------------------------------------------
// Field model
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'number' | 'select' | 'switch' | 'textarea' | 'password' | 'multiselect';

export interface FieldDef {
    key: string;
    label: string;
    type: FieldType;
    required?: boolean;
    helper?: string;
    placeholder?: string;
    options?: { value: string; label: string }[];
    defaultValue?: string | number | boolean;
    visible?: (values: Record<string, unknown>) => boolean;
}

export type FormValues = Record<string, string | number | boolean | string[] | undefined>;

// ---------------------------------------------------------------------------
// Generic form-driven action dialog. Renders fields, handles submit + spinner
// + error + result-output panel. Re-usable across all pool/device actions.
// `requireTyped` adds typed-name confirmation for destructive forms.
// ---------------------------------------------------------------------------

interface FormDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    description?: React.ReactNode;
    fields: FieldDef[];
    submitLabel?: string;
    submitVariant?: 'primary' | 'danger' | 'warning';
    // A function gates on form values (e.g. only destructive when a switch is on).
    requireTyped?: string | ((values: FormValues) => string | undefined);
    onSubmit: (values: FormValues) => Promise<string>;
    onSuccess?: () => void;
}

export function FormDialog({
    isOpen, onClose, title, description, fields,
    submitLabel = _("Apply"), submitVariant = 'primary', requireTyped,
    onSubmit, onSuccess,
}: FormDialogProps) {
    const dialogId = React.useId();
    const [values, setValues] = React.useState<FormValues>({});
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<string | null>(null);
    const [typed, setTyped] = React.useState('');

    // Re-initialize only when the dialog opens: fields can gain async-loaded
    // options (e.g. the disk lists in the create-pool dialog) while open, and
    // that must not wipe what the user already typed.
    const wasOpen = React.useRef(false);
    React.useEffect(() => {
        if (isOpen && !wasOpen.current) {
            const init: FormValues = {};
            for (const f of fields) {
                if (f.defaultValue !== undefined) init[f.key] = f.defaultValue as FormValues[string];
            }
            setValues(init);
            setError(null);
            setResult(null);
            setBusy(false);
            setTyped('');
        }
        wasOpen.current = isOpen;
    }, [isOpen, fields]);

    const set = (key: string, value: FormValues[string]) =>
        setValues(prev => ({ ...prev, [key]: value }));

    const handleSubmit = async () => {
        setBusy(true);
        setError(null);
        try {
            const out = await onSubmit(values);
            setResult(out || _("Command completed successfully."));
            onSuccess?.();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const isVisible = (f: FieldDef) => !f.visible || f.visible(values);

    const missingRequired = fields
            .filter(isVisible)
            .some(f => {
                const v = values[f.key];
                return f.required && (Array.isArray(v) ? v.length === 0 : v === undefined || v === '');
            });

    const requireTypedName = typeof requireTyped === 'function' ? requireTyped(values) : requireTyped;
    const typedOk = !requireTypedName || typed === requireTypedName;

    return (
        <Modal
            variant={ModalVariant.medium}
            isOpen={isOpen}
            // Keep the modal open until the command completes so its result can
            // be shown; Escape/backdrop dismissal is ignored while running.
            onClose={() => { if (!busy) onClose(); }}
            aria-labelledby={`${dialogId}-title`}
            {...defined({ 'aria-describedby': description ? `${dialogId}-description` : undefined })}
        >
            <ModalHeader title={title} description={description} labelId={`${dialogId}-title`} descriptorId={`${dialogId}-description`} />
            <ModalBody>
                {result
                    ? (
                        <Stack hasGutter>
                            <StackItem>
                                <Alert variant="success" title={_("Command completed")} isInline />
                            </StackItem>
                            {result.trim() && (
                                <StackItem>
                                    <CodeBlock>
                                        <CodeBlockCode>{result}</CodeBlockCode>
                                    </CodeBlock>
                                </StackItem>
                            )}
                        </Stack>
                    )
                    : (
                        <Form isHorizontal onSubmit={e => { e.preventDefault(); if (!busy && !missingRequired && typedOk) handleSubmit(); }}>
                            {error && (
                                <Alert variant="danger" title={_("Command failed")} isInline>
                                    <CodeBlock>
                                        <CodeBlockCode>{error}</CodeBlockCode>
                                    </CodeBlock>
                                </Alert>
                            )}
                            {fields.filter(isVisible).map(f => (
                                <FormGroup key={f.key} label={f.label} fieldId={`${dialogId}-${f.key}`} {...defined({ isRequired: f.required })}>
                                    {renderField(f, values[f.key], v => set(f.key, v), `${dialogId}-${f.key}`)}
                                    {f.helper && (
                                        <FormHelperText>
                                            <HelperText>
                                                <HelperTextItem id={`${dialogId}-${f.key}-helper`}>{f.helper}</HelperTextItem>
                                            </HelperText>
                                        </FormHelperText>
                                    )}
                                </FormGroup>
                            ))}
                            {requireTypedName && (
                                <FormGroup label={cockpit.format(_("Type \"$0\" to confirm"), requireTypedName)} fieldId={`${dialogId}-confirm-typed`}>
                                    <TextInput id={`${dialogId}-confirm-typed`} value={typed} onChange={(_e, v) => setTyped(v)} />
                                </FormGroup>
                            )}
                        </Form>
                    )}
            </ModalBody>
            <ModalFooter>
                {result
                    ? (
                        <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
                    )
                    : (
                        <>
                            <Button
                                variant={submitVariant}
                                onClick={handleSubmit}
                                isDisabled={busy || missingRequired || !typedOk}
                                isLoading={busy}
                            >
                                {submitLabel}
                            </Button>
                            <Button variant="link" onClick={onClose} isDisabled={busy}>
                                {_("Cancel")}
                            </Button>
                        </>
                    )}
            </ModalFooter>
        </Modal>
    );
}

function renderField(f: FieldDef, value: FormValues[string], set: (v: FormValues[string]) => void, id: string) {
    const accessibility = defined({ 'aria-describedby': f.helper ? `${id}-helper` : undefined, 'aria-required': f.required });
    switch (f.type) {
    case 'text':
    case 'password':
        return (
            <TextInput
                id={id}
                {...accessibility}
                type={f.type === 'password' ? 'password' : 'text'}
                value={(value as string | undefined) ?? ''}
                onChange={(_e, v) => set(v)}
                {...defined({ placeholder: f.placeholder })}
            />
        );
    case 'number':
        return (
            <TextInput
                id={id}
                {...accessibility}
                type="number"
                value={(value as number | string | undefined) ?? ''}
                onChange={(_e, v) => set(v === '' ? undefined : Number(v))}
                {...defined({ placeholder: f.placeholder })}
            />
        );
    case 'textarea':
        return (
            <TextArea
                id={id}
                {...accessibility}
                value={(value as string | undefined) ?? ''}
                rows={4}
                onChange={(_e, v) => set(v)}
                {...defined({ placeholder: f.placeholder })}
            />
        );
    case 'select':
        return (
            <FormSelect
                id={id}
                {...accessibility}
                value={(value as string | undefined) ?? ''}
                onChange={(_e, v) => set(v)}
            >
                <FormSelectOption value="" label="—" />
                {(f.options ?? []).map(o => (
                    <FormSelectOption key={o.value} value={o.value} label={o.label} />
                ))}
            </FormSelect>
        );
    case 'switch':
        return (
            <Switch
                id={id}
                {...accessibility}
                isChecked={Boolean(value)}
                onChange={(_e, v) => set(v)}
                label={_("Enabled")}
            />
        );
    case 'multiselect':
        return (
            <MultiSelectField
                id={id}
                options={f.options ?? []}
                value={(value as string[] | undefined) ?? []}
                set={set}
                {...accessibility}
            />
        );
    }
}

// Checkbox dropdown for picking several devices: PF6 Select with checkbox
// options; chosen paths are shown as removable chips under the toggle.
function MultiSelectField({ id, options, value, set, ...toggleProps }: {
    id: string;
    options: { value: string; label: string }[];
    value: string[];
    set: (v: string[]) => void;
}) {
    const [open, setOpen] = React.useState(false);
    const toggleValue = (v: string) =>
        set(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
    return (
        <div>
            <Select
                isOpen={open}
                onOpenChange={setOpen}
                selected={value}
                role="menu"
                onSelect={(_e, v) => { if (typeof v === 'string') toggleValue(v); }}
                toggle={toggleRef => (
                    <MenuToggle
                        id={id}
                        ref={toggleRef}
                        isExpanded={open}
                        isFullWidth
                        isPlaceholder={value.length === 0}
                        onClick={() => setOpen(o => !o)}
                        {...toggleProps}
                    >
                        {value.length
                            ? cockpit.format(_("$0 selected"), value.length)
                            : (options.length ? _("Select devices…") : _("No available devices"))}
                    </MenuToggle>
                )}
            >
                <SelectList>
                    {options.map(o => (
                        <SelectOption key={o.value} value={o.value} hasCheckbox isSelected={value.includes(o.value)}>
                            {o.label}
                        </SelectOption>
                    ))}
                </SelectList>
            </Select>
            {value.length > 0 && (
                <Flex spaceItems={{ default: 'spaceItemsXs' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: 'var(--pf-v6-global--spacer--sm)' }}>
                    {value.map(v => (
                        <Label
                            key={v}
                            isCompact
                            closeBtnAriaLabel={cockpit.format(_("Remove $0"), v)}
                            onClose={() => set(value.filter(x => x !== v))}
                        >
                            {v}
                        </Label>
                    ))}
                </Flex>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Confirm dialog for destructive operations.
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    body: React.ReactNode;
    confirmLabel?: string;
    confirmVariant?: 'primary' | 'danger' | 'warning';
    requireTyped?: string;
    onConfirm: () => Promise<string>;
    onSuccess?: () => void;
}

export function ConfirmDialog({
    isOpen, onClose, title, body,
    confirmLabel = _("Confirm"), confirmVariant = 'danger',
    requireTyped, onConfirm, onSuccess,
}: ConfirmDialogProps) {
    const dialogId = React.useId();
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<string | null>(null);
    const [typed, setTyped] = React.useState('');

    React.useEffect(() => {
        if (isOpen) {
            setBusy(false);
            setError(null);
            setResult(null);
            setTyped('');
        }
    }, [isOpen]);

    const handle = async () => {
        setBusy(true);
        setError(null);
        try {
            const out = await onConfirm();
            setResult(out || _("Done."));
            onSuccess?.();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const canConfirm = !busy && (!requireTyped || typed === requireTyped);

    return (
        <Modal variant={ModalVariant.small} isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} aria-labelledby={`${dialogId}-title`}>
            <ModalHeader title={title} labelId={`${dialogId}-title`} titleIconVariant={confirmVariant === 'danger' ? 'danger' : 'warning'} />
            <ModalBody>
                <Stack hasGutter>
                    {result
                        ? <StackItem><Alert variant="success" title={_("Command completed")} isInline /></StackItem>
                        : <StackItem>{body}</StackItem>}
                    {error && (
                        <StackItem>
                            <Alert variant="danger" title={_("Command failed")} isInline>
                                <CodeBlock>
                                    <CodeBlockCode>{error}</CodeBlockCode>
                                </CodeBlock>
                            </Alert>
                        </StackItem>
                    )}
                    {!result && requireTyped && (
                        <StackItem>
                            <FormGroup label={cockpit.format(_("Type \"$0\" to confirm"), requireTyped)} fieldId={`${dialogId}-confirm-typed`}>
                                <TextInput id={`${dialogId}-confirm-typed`} value={typed} onChange={(_e, v) => setTyped(v)} />
                            </FormGroup>
                        </StackItem>
                    )}
                </Stack>
            </ModalBody>
            <ModalFooter>
                {result
                    ? <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
                    : (
                        <>
                            <Button variant={confirmVariant} onClick={handle} isDisabled={!canConfirm} isLoading={busy}>
                                {confirmLabel}
                            </Button>
                            <Button variant="link" onClick={onClose} isDisabled={busy}>
                                {_("Cancel")}
                            </Button>
                        </>
                    )}
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Result/output viewer (for show commands).
// ---------------------------------------------------------------------------

interface OutputDialogProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    fetch: () => Promise<string>;
}

export function OutputDialog({ isOpen, onClose, title, fetch }: OutputDialogProps) {
    const dialogId = React.useId();
    const [output, setOutput] = React.useState<string>('');
    const [error, setError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        if (!isOpen) return;
        setBusy(true);
        setError(null);
        setOutput('');
        fetch().then(setOutput)
                .catch(e => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(false));
    }, [isOpen, fetch]);

    return (
        // Same rule as the other command dialogs: keep it open until the
        // command completes so the outcome can be presented.
        <Modal variant={ModalVariant.large} isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} aria-labelledby={`${dialogId}-title`}>
            <ModalHeader title={title} labelId={`${dialogId}-title`} />
            <ModalBody>
                {busy && <Spinner aria-label={_("Loading command output")} />}
                {error && (
                    <Alert variant="danger" title={_("Command failed")} isInline>
                        <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                    </Alert>
                )}
                {!busy && !error && output && (
                    <Alert variant="success" title={_("Command completed")} isInline />
                )}
                {output && (
                    <CodeBlock>
                        <CodeBlockCode>{output}</CodeBlockCode>
                    </CodeBlock>
                )}
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={onClose} isDisabled={busy}>{_("Close")}</Button>
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Raw zfs/zpool command runner — escape hatch for the long tail of operations
// (send/receive pipes, redact, program, allow, …).
// ---------------------------------------------------------------------------

interface RawCommandDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onRun: (cmdline: string) => Promise<string>;
}

export function RawCommandDialog({ isOpen, onClose, onRun }: RawCommandDialogProps) {
    const dialogId = React.useId();
    const [cmd, setCmd] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [output, setOutput] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (isOpen) {
            setCmd('');
            setOutput(null);
            setError(null);
            setBusy(false);
        }
    }, [isOpen]);

    const handle = async () => {
        if (!cmd.trim()) return;
        setBusy(true);
        setError(null);
        setOutput(null);
        try {
            const out = await onRun(cmd);
            setOutput(out || _("(no output)"));
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal variant={ModalVariant.large} isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}>
            <ModalHeader
                title={_("Run zfs/zpool command")}
                descriptorId={`${dialogId}-description`}
                labelId={`${dialogId}-title`}
                description={_("Execute any zfs or zpool command. The leading \"zfs\"/\"zpool\" is required. zfs and zpool commands only.")}
            />
            <ModalBody>
                <Stack hasGutter>
                    <StackItem>
                        <FormGroup label={_("Command")} fieldId={`${dialogId}-raw-cmd`} isRequired>
                            <TextArea
                                id={`${dialogId}-raw-cmd`}
                                aria-describedby={`${dialogId}-raw-cmd-helper`}
                                isRequired
                                rows={3}
                                value={cmd}
                                placeholder="zpool status -P"
                                onChange={(_e, v) => setCmd(v)}
                            />
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem id={`${dialogId}-raw-cmd-helper`}>
                                        {_("Examples: \"zpool status -P\", \"zfs list -t snapshot -o name,used\", \"zpool get all tank\"")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        </FormGroup>
                    </StackItem>
                    {error && (
                        <StackItem>
                            <Alert variant="danger" title={_("Command failed")} isInline>
                                <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                            </Alert>
                        </StackItem>
                    )}
                    {output && (
                        <StackItem>
                            <CodeBlock>
                                <CodeBlockCode>{output}</CodeBlockCode>
                            </CodeBlock>
                        </StackItem>
                    )}
                </Stack>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" onClick={handle} isDisabled={busy || !cmd.trim()} isLoading={busy}>
                    {_("Run")}
                </Button>
                <Button variant="link" onClick={onClose} isDisabled={busy}>
                    {_("Close")}
                </Button>
            </ModalFooter>
        </Modal>
    );
}

// ---------------------------------------------------------------------------
// Create pool dialog — a FormDialog-driven wrapper building `zpool create`
// argv from the layout + member lists. Devices come from `lsblk` via
// fetchAvailableDisks (pool members are already filtered out there).
// ---------------------------------------------------------------------------

function diskOptions(disks: BlockDevice[]): { value: string; label: string }[] {
    return disks.map(d => ({
        value: d.path,
        label: `${d.path} — ${cockpit.format_bytes(d.size)} ${d.model ? d.model + ' ' : ''}(${d.rotational ? 'HDD' : 'SSD'})`,
    }));
}

function createPoolFields(disks: BlockDevice[], diskError: string | null): FieldDef[] {
    const options = diskOptions(disks);
    return [
        { key: 'name', label: _("Pool name"), type: 'text', required: true, placeholder: 'tank' },
        {
            key: 'layout',
            label: _("Vdev layout"),
            type: 'select',
            defaultValue: 'stripe',
            helper: _("Stripe = each member is its own top-level vdev. draid variants are draid<parity>."),
            options: [
                { value: 'stripe', label: _("Stripe (no redundancy)") },
                { value: 'mirror', label: 'mirror' },
                { value: 'raidz1', label: 'raidz1' },
                { value: 'raidz2', label: 'raidz2' },
                { value: 'raidz3', label: 'raidz3' },
                { value: 'draid1', label: 'draid1' },
                { value: 'draid2', label: 'draid2' },
                { value: 'draid3', label: 'draid3' },
            ],
        },
        {
            key: 'members',
            label: _("Member devices"),
            type: 'multiselect',
            required: true,
            options,
            helper: diskError
                ? cockpit.format(_("Could not list available disks: $0"), diskError)
                : _("Disks or partitions to use. Devices already assigned to a pool are not listed."),
        },
        { key: 'logDevices', label: _("Log devices"), type: 'multiselect', options, helper: _("Optional. Becomes the \"log\" section; use the raw console for a log mirror.") },
        { key: 'cacheDevices', label: _("Cache devices"), type: 'multiselect', options, helper: _("Optional. Becomes the \"cache\" section.") },
        { key: 'spareDevices', label: _("Spares"), type: 'multiselect', options, helper: _("Optional. Becomes the \"spares\" section.") },
        { key: 'force', label: _("Force (-f)"), type: 'switch', helper: _("Allow devices in use or of mixed sizes.") },
        { key: 'altroot', label: _("Alternate root (-R)"), type: 'text', placeholder: '/mnt' },
        { key: 'mountpoint', label: _("Mount point (-m)"), type: 'text', placeholder: '/tank' },
        {
            key: 'properties',
            label: _("Pool properties"),
            type: 'textarea',
            placeholder: "ashift=12\ncomment=production",
            helper: _("Pool properties as key=value, one per line (zpool create -o)."),
        },
    ];
}

const pickDevices = (values: FormValues, key: string): string[] =>
    (values[key] as string[] | undefined) ?? [];

async function submitCreatePool(values: FormValues): Promise<string> {
    const members = pickDevices(values, 'members');
    const logDevices = pickDevices(values, 'logDevices');
    const cacheDevices = pickDevices(values, 'cacheDevices');
    const spareDevices = pickDevices(values, 'spareDevices');
    const layout = String(values.layout ?? 'stripe');
    const vdevs = [
        ...(layout === 'stripe' ? members : [layout, ...members]),
        ...(logDevices.length ? ['log', ...logDevices] : []),
        ...(cacheDevices.length ? ['cache', ...cacheDevices] : []),
        ...(spareDevices.length ? ['spare', ...spareDevices] : []),
    ];
    const properties = parseKeyValues(String(values.properties ?? ''));
    return svc.poolCreate({
        name: String(values.name ?? '').trim(),
        vdevs,
        force: Boolean(values.force),
        ...defined({
            altroot: String(values.altroot ?? '').trim() || undefined,
            mountpoint: String(values.mountpoint ?? '').trim() || undefined,
            properties: Object.keys(properties).length ? properties : undefined,
        }),
    });
}

export function CreatePoolDialog({ isOpen, onClose, onSuccess }: {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [disks, setDisks] = React.useState<BlockDevice[]>([]);
    const [diskError, setDiskError] = React.useState<string | null>(null);
    React.useEffect(() => {
        if (!isOpen) return;
        // Drop the previous session's list: a device may have joined a pool
        // since, and stale options must not be selectable while refetching.
        setDisks([]);
        setDiskError(null);
        let alive = true;
        svc.fetchAvailableDisks()
                .then(found => { if (alive) setDisks(found); })
                .catch((e: unknown) => {
                    if (!alive) return;
                    setDisks([]);
                    setDiskError(e instanceof Error ? e.message : String(e));
                });
        return () => { alive = false };
    }, [isOpen]);
    return (
        <FormDialog
            isOpen={isOpen}
            onClose={onClose}
            title={_("Create pool")}
            description={_("Create a new ZFS storage pool from available disks or partitions.")}
            fields={createPoolFields(disks, diskError)}
            submitLabel={_("Create pool")}
            onSubmit={submitCreatePool}
            onSuccess={onSuccess}
        />
    );
}

// ---------------------------------------------------------------------------
// Import pool dialog — searches for importable pools, summarizes the selected
// pool's config, and runs `zpool import` with the chosen options.
// ---------------------------------------------------------------------------

function vdevSummaryLines(vdevs: Vdev[]): string[] {
    const lines: string[] = [];
    const walk = (node: Vdev, depth: number) => {
        const indent = '  '.repeat(depth);
        lines.push(node.state ? `${indent}${node.name}  ${node.state}` : `${indent}${node.name}`);
        for (const child of node.children) walk(child, depth + 1);
    };
    for (const node of vdevs) walk(node, 0);
    return lines;
}

interface ImportPoolDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export function ImportPoolDialog({ isOpen, onClose, onSuccess }: ImportPoolDialogProps) {
    const dialogId = React.useId();
    const [searchDir, setSearchDir] = React.useState('');
    const [pools, setPools] = React.useState<ImportablePool[]>([]);
    const [selected, setSelected] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [searchError, setSearchError] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [result, setResult] = React.useState<string | null>(null);
    const [importAll, setImportAll] = React.useState(false);
    const [force, setForce] = React.useState(false);
    const [nomount, setNomount] = React.useState(false);
    const [readonly, setReadonly] = React.useState(false);
    const [newName, setNewName] = React.useState('');
    const [altroot, setAltroot] = React.useState('');

    const runSearch = React.useCallback((dir: string) => {
        setLoading(true);
        setSearchError(null);
        return svc.fetchImportablePools(dir || undefined)
                .then(found => {
                    setPools(found);
                    setSelected(prev => (found.some(p => p.name === prev) ? prev : (found[0]?.name ?? '')));
                })
                .catch((e: unknown) => {
                    setSearchError(e instanceof Error ? e.message : String(e));
                    setPools([]);
                })
                .finally(() => setLoading(false));
    }, []);

    React.useEffect(() => {
        if (!isOpen) return;
        setResult(null);
        setError(null);
        setBusy(false);
        setImportAll(false);
        setForce(false);
        setNomount(false);
        setReadonly(false);
        setNewName('');
        setAltroot('');
        const dir = readSettings().importSearchDir;
        setSearchDir(dir);
        runSearch(dir);
    }, [isOpen, runSearch]);

    const pool = pools.find(p => p.name === selected);

    const handleImport = async () => {
        setBusy(true);
        setError(null);
        try {
            // `zpool import` has no readonly flag; it is an -o property.
            const properties = readonly ? { readonly: 'on' } : undefined;
            const base = {
                force: Boolean(force),
                nomount: Boolean(nomount),
                ...defined({
                    searchDir: searchDir.trim() || undefined,
                    altroot: altroot.trim() || undefined,
                    properties,
                }),
            };
            const out = importAll
                ? await svc.poolImport({ ...base, all: true })
                : await svc.poolImport({
                    ...base,
                    pool: selected,
                    ...defined({ newName: newName.trim() || undefined }),
                });
            setResult(out || _("Pool imported."));
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
            isOpen={isOpen}
            onClose={() => { if (!busy) onClose(); }}
            aria-labelledby={`${dialogId}-title`}
            aria-describedby={`${dialogId}-description`}
        >
            <ModalHeader
                title={_("Import pool")}
                labelId={`${dialogId}-title`}
                descriptorId={`${dialogId}-description`}
                description={_("Search for pools exported on this system and import them.")}
            />
            <ModalBody>
                {result
                    ? (
                        <Stack hasGutter>
                            <StackItem>
                                <Alert variant="success" title={_("Command completed")} isInline />
                            </StackItem>
                            {result.trim() && (
                                <StackItem>
                                    <CodeBlock>
                                        <CodeBlockCode>{result}</CodeBlockCode>
                                    </CodeBlock>
                                </StackItem>
                            )}
                        </Stack>
                    )
                    : (
                        <Form isHorizontal onSubmit={e => { e.preventDefault(); if (!busy && (importAll || selected)) handleImport(); }}>
                            {error && (
                                <Alert variant="danger" title={_("Command failed")} isInline>
                                    <CodeBlock><CodeBlockCode>{error}</CodeBlockCode></CodeBlock>
                                </Alert>
                            )}
                            <FormGroup label={_("Search directory (-d)")} fieldId={`${dialogId}-search-dir`}>
                                <TextInput
                                    id={`${dialogId}-search-dir`}
                                    value={searchDir}
                                    placeholder={_("(default search paths)")}
                                    onChange={(_e, v) => setSearchDir(v)}
                                />
                                <FormHelperText>
                                    <HelperText>
                                        <HelperTextItem>
                                            {_("Directory to scan for device labels. Default value comes from Settings.")}
                                        </HelperTextItem>
                                    </HelperText>
                                </FormHelperText>
                            </FormGroup>
                            <FormGroup label={_("Available pools")} fieldId={`${dialogId}-pool`}>
                                <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                                    <FormSelect
                                        id={`${dialogId}-pool`}
                                        value={selected}
                                        isDisabled={importAll || loading}
                                        onChange={(_e, v) => setSelected(v)}
                                    >
                                        {pools.length === 0 && <FormSelectOption value="" label={loading ? _("Searching…") : _("No importable pools found")} />}
                                        {pools.map(p => (
                                            <FormSelectOption key={p.id || p.name} value={p.name} label={`${p.name} (${p.state})`} />
                                        ))}
                                    </FormSelect>
                                    <Button variant="secondary" onClick={() => runSearch(searchDir)} isLoading={loading}>
                                        {_("Search")}
                                    </Button>
                                </Flex>
                                {searchError && (
                                    <FormHelperText>
                                        <HelperText>
                                            <HelperTextItem variant="error">{searchError}</HelperTextItem>
                                        </HelperText>
                                    </FormHelperText>
                                )}
                            </FormGroup>
                            {!importAll && pool && (
                                <FormGroup label={_("Selected pool")} fieldId={`${dialogId}-summary`}>
                                    <div id={`${dialogId}-summary`} className="zfs-import-summary">
                                        <DescriptionList isCompact>
                                            <DescriptionListGroup>
                                                <DescriptionListTerm>{_("Name")}</DescriptionListTerm>
                                                <DescriptionListDescription>{pool.name}</DescriptionListDescription>
                                            </DescriptionListGroup>
                                            <DescriptionListGroup>
                                                <DescriptionListTerm>{_("ID")}</DescriptionListTerm>
                                                <DescriptionListDescription>{pool.id}</DescriptionListDescription>
                                            </DescriptionListGroup>
                                            <DescriptionListGroup>
                                                <DescriptionListTerm>{_("State")}</DescriptionListTerm>
                                                <DescriptionListDescription>{pool.state}</DescriptionListDescription>
                                            </DescriptionListGroup>
                                            {pool.statusText && (
                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                                                    <DescriptionListDescription>{pool.statusText}</DescriptionListDescription>
                                                </DescriptionListGroup>
                                            )}
                                            {pool.actionText && (
                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>{_("Action")}</DescriptionListTerm>
                                                    <DescriptionListDescription>{pool.actionText}</DescriptionListDescription>
                                                </DescriptionListGroup>
                                            )}
                                        </DescriptionList>
                                        <CodeBlock className="zfs-import-config">
                                            <CodeBlockCode>{vdevSummaryLines(pool.vdevs).join('\n')}</CodeBlockCode>
                                        </CodeBlock>
                                    </div>
                                </FormGroup>
                            )}
                            <FormGroup label={_("Import all (-a)")} fieldId={`${dialogId}-import-all`}>
                                <Switch
                                    id={`${dialogId}-import-all`}
                                    isChecked={importAll}
                                    onChange={(_e, v) => setImportAll(v)}
                                    label={_("Import every pool found")}
                                />
                            </FormGroup>
                            <FormGroup label={_("New name")} fieldId={`${dialogId}-new-name`}>
                                <TextInput
                                    id={`${dialogId}-new-name`}
                                    value={newName}
                                    isDisabled={importAll}
                                    onChange={(_e, v) => setNewName(v)}
                                />
                            </FormGroup>
                            <FormGroup label={_("Alternate root (-R)")} fieldId={`${dialogId}-altroot`}>
                                <TextInput id={`${dialogId}-altroot`} value={altroot} onChange={(_e, v) => setAltroot(v)} />
                            </FormGroup>
                            <FormGroup label={_("Options")} fieldId={`${dialogId}-force`}>
                                <Stack hasGutter>
                                    <StackItem>
                                        <Switch id={`${dialogId}-force`} isChecked={force} onChange={(_e, v) => setForce(v)} label={_("Force (-f)")} />
                                    </StackItem>
                                    <StackItem>
                                        <Switch id={`${dialogId}-nomount`} isChecked={nomount} onChange={(_e, v) => setNomount(v)} label={_("Do not mount datasets (-N)")} />
                                    </StackItem>
                                    <StackItem>
                                        <Switch id={`${dialogId}-readonly`} isChecked={readonly} onChange={(_e, v) => setReadonly(v)} label={_("Read-only (-o readonly=on)")} />
                                    </StackItem>
                                </Stack>
                            </FormGroup>
                        </Form>
                    )}
            </ModalBody>
            <ModalFooter>
                {result
                    ? <Button variant="primary" onClick={onClose}>{_("Close")}</Button>
                    : (
                        <>
                            <Button
                                variant="primary"
                                onClick={handleImport}
                                isDisabled={busy || loading || (!importAll && !selected)}
                                isLoading={busy}
                            >
                                {_("Import")}
                            </Button>
                            <Button variant="link" onClick={onClose} isDisabled={busy}>
                                {_("Cancel")}
                            </Button>
                        </>
                    )}
            </ModalFooter>
        </Modal>
    );
}
