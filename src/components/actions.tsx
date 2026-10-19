import React from 'react';
import { Dropdown, DropdownItem, DropdownList, DropdownGroup } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { MenuToggle } from "@patternfly/react-core/dist/esm/components/MenuToggle/index.js";
import EllipsisVIcon from "@patternfly/react-icons/dist/esm/icons/ellipsis-v-icon.js";
import cockpit from 'cockpit';

import { FormDialog, ConfirmDialog, OutputDialog, splitList, type FieldDef, type FormValues } from './dialogs';
import { readSettings } from './settingsPage';
import * as svc from '../service';
import type { Pool, Vdev } from '../types';

const _ = cockpit.gettext;

// Helper: omit undefined values so we can spread without violating
// exactOptionalPropertyTypes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defined(obj: Record<string, unknown>): any {
    const out: Record<string, unknown> = {};
    for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
    return out;
}

// ---------------------------------------------------------------------------
// Generic kebab dropdown driving a list of declarative action items.
// Each item is either an action handler or opens a dialog.
// ---------------------------------------------------------------------------

export interface ActionItem {
    id: string;
    label: string;
    description?: string;
    isDanger?: boolean;
    isDisabled?: boolean;
    group?: string;
    onSelect: () => void;
}

interface ActionMenuProps {
    items: ActionItem[];
    label?: string;
}

export function ActionMenu({ items, label = _("Actions") }: ActionMenuProps) {
    const [open, setOpen] = React.useState(false);

    const groups = new Map<string, ActionItem[]>();
    for (const it of items) {
        const g = it.group ?? '';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(it);
    }

    return (
        <Dropdown
            isOpen={open}
            onSelect={() => setOpen(false)}
            onOpenChange={setOpen}
            popperProps={{ position: 'right', appendTo: () => document.body }}
            maxMenuHeight="min(28rem, 60vh)"
            className="zfs-action-menu"
            shouldFocusToggleOnSelect
            toggle={(toggleRef) => (
                <MenuToggle
                    ref={toggleRef}
                    aria-label={label}
                    variant="plain"
                    onClick={() => setOpen(o => !o)}
                    isExpanded={open}
                    icon={<EllipsisVIcon />}
                />
            )}
        >
            {[...groups.entries()].map(([group, groupItems], idx) => (
                <DropdownGroup key={idx} {...defined({ label: group || undefined })}>
                    <DropdownList>
                        {groupItems.map(it => (
                            <DropdownItem
                                key={it.id}
                                onClick={() => { setOpen(false); it.onSelect() }}
                                {...defined({
                                    description: it.description,
                                    isDanger: it.isDanger,
                                    isDisabled: it.isDisabled,
                                })}
                            >
                                {it.label}
                            </DropdownItem>
                        ))}
                    </DropdownList>
                </DropdownGroup>
            ))}
        </Dropdown>
    );
}

// ---------------------------------------------------------------------------
// Dialog state management — small reducer to track which dialog is open.
// ---------------------------------------------------------------------------

interface FormDialogDef {
    title: string;
    description?: string;
    fields: FieldDef[];
    submitLabel?: string;
    submitVariant?: 'primary' | 'danger' | 'warning';
    requireTyped?: string | ((values: FormValues) => string | undefined);
    onSubmit: (values: FormValues) => Promise<string>;
}

interface ConfirmDef {
    title: string;
    body: React.ReactNode;
    confirmLabel?: string;
    confirmVariant?: 'primary' | 'danger' | 'warning';
    requireTyped?: string;
    onConfirm: () => Promise<string>;
}

type DialogState =
    | { kind: 'none' }
    | { kind: 'form'; def: FormDialogDef }
    | { kind: 'confirm'; def: ConfirmDef }
    | { kind: 'output'; title: string; fetch: () => Promise<string> };

export function useDialogs(onChanged?: () => void) {
    const [state, setState] = React.useState<DialogState>({ kind: 'none' });
    const close = () => setState({ kind: 'none' });
    const refresh = () => onChanged?.();

    const openForm = (def: FormDialogDef) => setState({ kind: 'form', def });
    const openConfirm = (def: ConfirmDef) => setState({ kind: 'confirm', def });
    const openOutput = (title: string, fetch: () => Promise<string>) =>
        setState({ kind: 'output', title, fetch });

    const node = (
        <>
            {state.kind === 'form' && (
                <FormDialog
                    isOpen
                    onClose={close}
                    title={state.def.title}
                    fields={state.def.fields}
                    // eslint-disable-next-line react/jsx-handler-names
                    onSubmit={state.def.onSubmit}
                    onSuccess={refresh}
                    {...defined({
                        description: state.def.description,
                        submitLabel: state.def.submitLabel,
                        submitVariant: state.def.submitVariant,
                        requireTyped: state.def.requireTyped,
                    })}
                />
            )}
            {state.kind === 'confirm' && (
                <ConfirmDialog
                    isOpen
                    onClose={close}
                    title={state.def.title}
                    body={state.def.body}
                    // eslint-disable-next-line react/jsx-handler-names
                    onConfirm={state.def.onConfirm}
                    onSuccess={refresh}
                    {...defined({
                        confirmLabel: state.def.confirmLabel,
                        confirmVariant: state.def.confirmVariant,
                        requireTyped: state.def.requireTyped,
                    })}
                />
            )}
            {state.kind === 'output' && (
                <OutputDialog isOpen onClose={close} title={state.title} fetch={state.fetch} />
            )}
        </>
    );

    return { node, openForm, openConfirm, openOutput, close, refresh };
}

type OpenDialogs = ReturnType<typeof useDialogs>;

// ---------------------------------------------------------------------------
// Destructive-op policy: typed name confirmation by default (Settings →
// "Confirm before destructive operations"); with it off, the action runs
// immediately and its output dialog reports the result.
// ---------------------------------------------------------------------------

interface DangerDef {
    title: string;
    body: React.ReactNode;
    name: string;
    confirmLabel?: string;
    onConfirm: () => Promise<string>;
}

function destructiveConfirm(open: OpenDialogs, def: DangerDef): void {
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

// Typed-name requirement for destructive forms (undefined when disabled).
function typedName(name: string): string | undefined {
    return readSettings().confirmDestructive ? name : undefined;
}

// Actions whose subcommand needs a newer OpenZFS are disabled with a reason.
function gated(cap: string): Partial<ActionItem> {
    return svc.hasCapability(cap)
        ? {}
        : { isDisabled: true, description: _("Requires newer OpenZFS") };
}

// ---------------------------------------------------------------------------
// Shared form fields
// ---------------------------------------------------------------------------

function devicesField(key: string, label: string): FieldDef {
    return {
        key,
        label,
        type: 'textarea',
        placeholder: '/dev/disk/by-id/…',
        helper: _("One per line or comma-separated. Leave empty for the whole pool."),
    };
}

function forceField(): FieldDef {
    return { key: 'force', label: _("Force (-f)"), type: 'switch' };
}

const ACTION_FIELDS: Record<string, string> = {
    start: _("Start"),
    cancel: _("Cancel"),
    suspend: _("Suspend"),
    resume: _("Resume"),
    unmonitor: _("Unmonitor"),
};

// ---------------------------------------------------------------------------
// Pool actions
// ---------------------------------------------------------------------------

export function poolActions(pool: Pool, open: OpenDialogs): ActionItem[] {
    const name = pool.name;

    return [
        // ---- Configuration ----
        {
            id: 'add-vdev',
            group: _("Configuration"),
            label: _("Add vdev…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Add vdev to pool $0"), name),
                fields: [
                    {
                        key: 'vdevs',
                        label: _("Vdev specification"),
                        type: 'textarea',
                        required: true,
                        helper: _("Devices plus optional keywords (mirror, raidz1, log, cache, spare…), separated by whitespace or new lines."),
                    },
                    forceField(),
                ],
                onSubmit: v => svc.poolAdd({
                    pool: name,
                    vdevs: splitList(String(v.vdevs ?? '')),
                    force: Boolean(v.force),
                }),
            }),
        },
        {
            id: 'remove-device',
            group: _("Configuration"),
            label: _("Remove device…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Remove device from pool $0"), name),
                fields: [
                    devicesField('devices', _("Devices")),
                    {
                        key: 'stop',
                        label: _("Cancel in-progress removal (-s)"),
                        type: 'switch',
                    },
                ],
                onSubmit: v => svc.poolRemove({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                    stop: Boolean(v.stop),
                }),
            }),
        },
        {
            id: 'attach',
            group: _("Configuration"),
            label: _("Attach…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Attach device in pool $0"), name),
                description: _("Attach a new device to an existing mirror or single-disk vdev."),
                fields: [
                    { key: 'device', label: _("Existing device"), type: 'text', required: true },
                    { key: 'newDevice', label: _("New device"), type: 'text', required: true },
                    forceField(),
                    { key: 'spare', label: _("Attach as hot spare (-s)"), type: 'switch' },
                ],
                onSubmit: v => svc.poolAttach({
                    pool: name,
                    device: String(v.device),
                    newDevice: String(v.newDevice),
                    force: Boolean(v.force),
                    spare: Boolean(v.spare),
                }),
            }),
        },
        {
            id: 'detach',
            group: _("Configuration"),
            label: _("Detach…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Detach device from pool $0"), name),
                fields: [{ key: 'device', label: _("Device"), type: 'text', required: true }],
                onSubmit: v => svc.poolDetach({ pool: name, device: String(v.device) }),
            }),
        },
        {
            id: 'replace',
            group: _("Configuration"),
            label: _("Replace…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Replace device in pool $0"), name),
                description: _("Replace a device with a new one, or with a hot spare when the new device is left empty."),
                fields: [
                    { key: 'device', label: _("Device to replace"), type: 'text', required: true },
                    { key: 'newDevice', label: _("Replacement device"), type: 'text' },
                    forceField(),
                ],
                onSubmit: v => svc.poolReplace({
                    pool: name,
                    device: String(v.device),
                    ...defined({ newDevice: String(v.newDevice ?? '').trim() || undefined }),
                    force: Boolean(v.force),
                }),
            }),
        },
        {
            id: 'set-property',
            group: _("Configuration"),
            label: _("Set property…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Set pool property on $0"), name),
                fields: [
                    { key: 'property', label: _("Property"), type: 'text', required: true, placeholder: 'ashift' },
                    { key: 'value', label: _("Value"), type: 'text', required: true },
                ],
                onSubmit: v => svc.poolSet({
                    properties: { [String(v.property)]: String(v.value) },
                    pool: name,
                }),
            }),
        },
        {
            id: 'upgrade',
            group: _("Configuration"),
            label: _("Upgrade pool…"),
            onSelect: () => open.openConfirm({
                title: _("Upgrade pool"),
                body: cockpit.format(_("Upgrade pool $0 to the latest feature set? This cannot be undone."), name),
                confirmVariant: 'warning',
                confirmLabel: _("Upgrade"),
                onConfirm: () => svc.poolUpgrade({ pool: name }),
            }),
        },

        // ---- Device state ----
        {
            id: 'online',
            group: _("Device state"),
            label: _("Online…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Online device in pool $0"), name),
                fields: [
                    devicesField('devices', _("Devices")),
                    { key: 'expand', label: _("Expand capacity (-e)"), type: 'switch' },
                ],
                onSubmit: v => svc.poolOnline({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                    expand: Boolean(v.expand),
                }),
            }),
        },
        {
            id: 'offline',
            group: _("Device state"),
            label: _("Offline…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Offline device in pool $0"), name),
                fields: [
                    devicesField('devices', _("Devices")),
                    forceField(),
                    { key: 'temporary', label: _("Temporary (-t)"), type: 'switch' },
                ],
                onSubmit: v => svc.poolOffline({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                    force: Boolean(v.force),
                    temporary: Boolean(v.temporary),
                }),
            }),
        },
        {
            id: 'clear-errors',
            group: _("Device state"),
            label: _("Clear errors…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Clear errors on pool $0"), name),
                fields: [devicesField('devices', _("Devices"))],
                onSubmit: v => svc.poolClear({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                }),
            }),
        },
        {
            id: 'labelclear',
            group: _("Device state"),
            label: _("Label clear…"),
            isDanger: true,
            onSelect: () => open.openForm({
                title: cockpit.format(_("Clear label on a device of $0"), name),
                description: _("Removes ZFS labels from a device so it can be reused. The device must not be active in a pool unless forced."),
                submitVariant: 'danger',
                submitLabel: _("Clear label"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [
                    { key: 'vdev', label: _("Device"), type: 'text', required: true },
                    forceField(),
                ],
                onSubmit: v => svc.poolLabelclear({ vdev: String(v.vdev), force: Boolean(v.force) }),
            }),
        },
        {
            id: 'reopen',
            group: _("Device state"),
            label: _("Reopen"),
            onSelect: () => open.openConfirm({
                title: _("Reopen devices"),
                body: cockpit.format(_("Reopen all devices in pool $0 after replacing underlying storage?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Reopen"),
                onConfirm: () => svc.poolReopen({ pool: name }),
            }),
        },
        {
            id: 'sync',
            group: _("Device state"),
            label: _("Sync"),
            onSelect: () => open.openConfirm({
                title: _("Sync pool"),
                body: cockpit.format(_("Flush all pending pool state of $0 to disk?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Sync"),
                onConfirm: () => svc.poolSync({ pool: name }),
            }),
        },

        // ---- Scrub & rebuild ----
        {
            id: 'scrub-start',
            group: _("Scrub & resilver"),
            label: _("Start scrub"),
            onSelect: () => open.openConfirm({
                title: _("Start scrub"),
                body: cockpit.format(_("Start a scrub of pool $0?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Start"),
                onConfirm: () => svc.poolScrub({ pool: name, action: 'start' }),
            }),
        },
        {
            id: 'scrub-pause',
            group: _("Scrub & resilver"),
            label: _("Pause scrub"),
            onSelect: () => open.openConfirm({
                title: _("Pause scrub"),
                body: cockpit.format(_("Pause the in-progress scrub of pool $0?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Pause"),
                onConfirm: () => svc.poolScrub({ pool: name, action: 'pause' }),
            }),
        },
        {
            id: 'scrub-resume',
            group: _("Scrub & resilver"),
            label: _("Resume scrub"),
            onSelect: () => open.openConfirm({
                title: _("Resume scrub"),
                body: cockpit.format(_("Resume the paused scrub of pool $0?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Resume"),
                onConfirm: () => svc.poolScrub({ pool: name, action: 'resume' }),
            }),
        },
        {
            id: 'scrub-stop',
            group: _("Scrub & resilver"),
            label: _("Stop scrub"),
            onSelect: () => open.openConfirm({
                title: _("Stop scrub"),
                body: cockpit.format(_("Stop the scrub of pool $0? Progress is lost."), name),
                confirmVariant: 'warning',
                confirmLabel: _("Stop"),
                onConfirm: () => svc.poolScrub({ pool: name, action: 'stop' }),
            }),
        },
        {
            id: 'resilver',
            group: _("Scrub & resilver"),
            label: _("Start resilver…"),
            ...gated('zpool.resilver'),
            onSelect: () => open.openConfirm({
                title: _("Start resilver"),
                body: cockpit.format(_("Start a resilver of pool $0?"), name),
                confirmVariant: 'primary',
                confirmLabel: _("Start"),
                onConfirm: () => svc.poolResilver({ pool: name }),
            }),
        },
        {
            id: 'trim',
            group: _("Scrub & resilver"),
            label: _("Trim…"),
            ...gated('zpool.trim'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("TRIM pool $0"), name),
                fields: [
                    {
                        key: 'action',
                        label: _("Action"),
                        type: 'select',
                        defaultValue: 'start',
                        options: ['start', 'cancel', 'suspend'].map(a => ({ value: a, label: ACTION_FIELDS[a] })),
                    },
                    { key: 'secure', label: _("Secure TRIM (-d)"), type: 'switch' },
                    { key: 'rate', label: _("Rate limit (-r)"), type: 'text', placeholder: '512M' },
                    devicesField('devices', _("Devices")),
                ],
                onSubmit: v => svc.poolTrim({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                    action: v.action as 'start',
                    secure: Boolean(v.secure),
                    ...defined({ rate: String(v.rate ?? '').trim() || undefined }),
                }),
            }),
        },
        {
            id: 'initialize',
            group: _("Scrub & resilver"),
            label: _("Initialize…"),
            ...gated('zpool.initialize'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Initialize pool $0"), name),
                description: _("Write to unallocated regions so bad blocks surface early."),
                fields: [
                    {
                        key: 'action',
                        label: _("Action"),
                        type: 'select',
                        defaultValue: 'start',
                        options: ['start', 'cancel', 'suspend', 'unmonitor'].map(a => ({ value: a, label: ACTION_FIELDS[a] })),
                    },
                    devicesField('devices', _("Devices")),
                ],
                onSubmit: v => svc.poolInitialize({
                    pool: name,
                    devices: splitList(String(v.devices ?? '')),
                    action: v.action as 'start',
                }),
            }),
        },

        // ---- Checkpoint ----
        {
            id: 'checkpoint-take',
            group: _("Checkpoint"),
            label: _("Take checkpoint"),
            ...gated('zpool.checkpoint'),
            onSelect: () => open.openConfirm({
                title: _("Take pool checkpoint"),
                body: cockpit.format(_("Checkpoint pool $0? The checkpoint keeps an on-disk rewind point until discarded."), name),
                confirmVariant: 'primary',
                confirmLabel: _("Checkpoint"),
                onConfirm: () => svc.poolCheckpoint({ pool: name }),
            }),
        },
        {
            id: 'checkpoint-show',
            group: _("Checkpoint"),
            label: _("Show checkpoint"),
            ...gated('zpool.checkpoint'),
            onSelect: () => open.openOutput(_("Pool checkpoint"), () => svc.poolGet({ properties: 'checkpoint', pool: name })),
        },
        {
            id: 'checkpoint-discard',
            group: _("Checkpoint"),
            label: _("Discard checkpoint…"),
            isDanger: true,
            ...gated('zpool.checkpoint'),
            onSelect: () => destructiveConfirm(open, {
                title: _("Discard pool checkpoint"),
                body: cockpit.format(_("Discard the checkpoint of pool $0? Rewinding to it becomes impossible."), name),
                name,
                confirmLabel: _("Discard"),
                onConfirm: () => svc.poolCheckpoint({ pool: name, discard: true }),
            }),
        },

        // ---- Maintenance ----
        {
            id: 'wait',
            group: _("Maintenance"),
            label: _("Wait…"),
            ...gated('zpool.wait'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Wait for activity on pool $0"), name),
                description: _("Blocks until the selected background activities finish."),
                fields: [{
                    key: 'activity',
                    label: _("Activities"),
                    type: 'text',
                    helper: _("Comma-separated (initialize, replace, remove, scrub, resilver, trim, free, prefetch, ddtprune…). Empty waits for all."),
                }],
                onSubmit: v => svc.poolWait({
                    pool: name,
                    ...defined({ activity: String(v.activity ?? '').trim() || undefined }),
                }),
            }),
        },
        {
            id: 'prefetch',
            group: _("Maintenance"),
            label: _("Prefetch…"),
            ...gated('zpool.prefetch'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Prefetch pool data for $0"), name),
                fields: [{
                    key: 'type',
                    label: _("Data type (-t)"),
                    type: 'text',
                    required: true,
                    defaultValue: 'ddt',
                    helper: _("OpenZFS currently supports only \"ddt\"."),
                }],
                onSubmit: v => svc.poolPrefetch({ pool: name, type: String(v.type) }),
            }),
        },
        {
            id: 'ddtprune',
            group: _("Maintenance"),
            label: _("DDT prune…"),
            isDanger: true,
            ...gated('zpool.ddtprune'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Prune DDT entries of pool $0"), name),
                description: _("Prunes dedup table entries so they can be evicted. Provide an age or a percentage."),
                submitVariant: 'danger',
                submitLabel: _("Prune"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [
                    { key: 'days', label: _("Older than days (-d)"), type: 'text' },
                    { key: 'percentage', label: _("Percentage of entries (-p)"), type: 'text' },
                ],
                onSubmit: v => svc.poolDdtprune({
                    pool: name,
                    ...defined({
                        days: String(v.days ?? '').trim() || undefined,
                        percentage: String(v.percentage ?? '').trim() || undefined,
                    }),
                }),
            }),
        },
        {
            id: 'split',
            group: _("Maintenance"),
            label: _("Split…"),
            isDanger: true,
            ...gated('zpool.split'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Split pool $0"), name),
                description: _("Splits a mirrored pool into two pools. All data written to the new pool since the split is lost."),
                submitVariant: 'danger',
                submitLabel: _("Split"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [
                    { key: 'newPool', label: _("New pool name"), type: 'text', required: true },
                    devicesField('devices', _("Devices to split off")),
                ],
                onSubmit: v => svc.poolSplit({
                    pool: name,
                    newPool: String(v.newPool),
                    devices: splitList(String(v.devices ?? '')),
                }),
            }),
        },
        {
            id: 'reguid',
            group: _("Maintenance"),
            label: _("Reguid…"),
            isDanger: true,
            onSelect: () => open.openForm({
                title: cockpit.format(_("Regenerate GUID of pool $0"), name),
                description: _("Regenerates the pool GUID so it can be imported alongside a copy of itself."),
                submitVariant: 'danger',
                submitLabel: _("Reguid"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [{ key: 'guid', label: _("New GUID"), type: 'text', helper: _("Leave empty to generate one.") }],
                onSubmit: v => svc.poolReguid({
                    pool: name,
                    ...(String(v.guid ?? '').trim() ? { guid: String(v.guid).trim() } : {}),
                }),
            }),
        },

        // ---- Inspect ----
        {
            id: 'show-history',
            group: _("Inspect"),
            label: _("Show history"),
            onSelect: () => open.openOutput(_("Pool history"), () => svc.poolHistory({ pool: name })),
        },
        {
            id: 'show-events',
            group: _("Inspect"),
            label: _("Show events"),
            onSelect: () => open.openOutput(_("Pool events"), () => svc.poolEvents({ pool: name })),
        },

        // ---- Danger zone ----
        {
            id: 'export',
            group: _("Danger zone"),
            label: _("Export…"),
            isDanger: true,
            onSelect: () => open.openForm({
                title: cockpit.format(_("Export pool $0"), name),
                description: _("Exports the pool, making it unavailable until imported again."),
                submitVariant: 'danger',
                submitLabel: _("Export"),
                ...defined({ requireTyped: typedName(name) }),
                fields: [forceField()],
                onSubmit: v => svc.poolExport({ pool: name, force: Boolean(v.force) }),
            }),
        },
        {
            id: 'destroy',
            group: _("Danger zone"),
            label: _("Destroy…"),
            isDanger: true,
            onSelect: () => destructiveConfirm(open, {
                title: _("Destroy pool"),
                body: cockpit.format(_("This permanently destroys pool $0 and ALL data on it. This cannot be undone."), name),
                name,
                confirmLabel: _("Destroy"),
                onConfirm: () => svc.poolDestroy({ pool: name }),
            }),
        },
    ];
}

// ---------------------------------------------------------------------------
// Vdev / disk actions
// ---------------------------------------------------------------------------

export function vdevActions(pool: Pool, node: Vdev, open: OpenDialogs): ActionItem[] {
    const name = pool.name;
    const device = node.name;

    return [
        {
            id: 'attach',
            group: _("Configuration"),
            label: _("Attach…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Attach device to $0"), device),
                fields: [
                    { key: 'newDevice', label: _("New device"), type: 'text', required: true },
                    forceField(),
                    { key: 'spare', label: _("Attach as hot spare (-s)"), type: 'switch' },
                ],
                onSubmit: v => svc.poolAttach({
                    pool: name,
                    device,
                    newDevice: String(v.newDevice),
                    force: Boolean(v.force),
                    spare: Boolean(v.spare),
                }),
            }),
        },
        {
            id: 'detach',
            group: _("Configuration"),
            label: _("Detach…"),
            onSelect: () => open.openConfirm({
                title: _("Detach device"),
                body: cockpit.format(_("Detach $0 from pool $1? The vdev loses redundancy until a replacement is attached."), device, name),
                confirmVariant: 'warning',
                confirmLabel: _("Detach"),
                onConfirm: () => svc.poolDetach({ pool: name, device }),
            }),
        },
        {
            id: 'replace',
            group: _("Configuration"),
            label: _("Replace…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Replace device $0"), device),
                fields: [
                    { key: 'newDevice', label: _("Replacement device"), type: 'text' },
                    forceField(),
                ],
                onSubmit: v => svc.poolReplace({
                    pool: name,
                    device,
                    ...defined({ newDevice: String(v.newDevice ?? '').trim() || undefined }),
                    force: Boolean(v.force),
                }),
            }),
        },
        {
            id: 'online',
            group: _("Device state"),
            label: _("Online…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Online device $0"), device),
                fields: [{ key: 'expand', label: _("Expand capacity (-e)"), type: 'switch' }],
                onSubmit: v => svc.poolOnline({
                    pool: name,
                    devices: [device],
                    expand: Boolean(v.expand),
                }),
            }),
        },
        {
            id: 'offline',
            group: _("Device state"),
            label: _("Offline…"),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Offline device $0"), device),
                fields: [
                    forceField(),
                    { key: 'temporary', label: _("Temporary (-t)"), type: 'switch' },
                ],
                onSubmit: v => svc.poolOffline({
                    pool: name,
                    devices: [device],
                    force: Boolean(v.force),
                    temporary: Boolean(v.temporary),
                }),
            }),
        },
        {
            id: 'remove',
            group: _("Device state"),
            label: _("Remove…"),
            onSelect: () => open.openConfirm({
                title: _("Remove device"),
                body: cockpit.format(_("Remove $0 from pool $1? Its data is copied to the remaining devices where possible."), device, name),
                confirmVariant: 'warning',
                confirmLabel: _("Remove"),
                onConfirm: () => svc.poolRemove({ pool: name, devices: [device] }),
            }),
        },
        {
            id: 'labelclear',
            group: _("Device state"),
            label: _("Label clear…"),
            isDanger: true,
            onSelect: () => open.openForm({
                title: cockpit.format(_("Clear label on $0"), device),
                description: _("Removes ZFS labels from the device so it can be reused."),
                submitVariant: 'danger',
                submitLabel: _("Clear label"),
                ...defined({ requireTyped: typedName(device) }),
                fields: [forceField()],
                onSubmit: v => svc.poolLabelclear({ vdev: device, force: Boolean(v.force) }),
            }),
        },
        {
            id: 'trim',
            group: _("Maintenance"),
            label: _("Trim…"),
            ...gated('zpool.trim'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("TRIM device $0"), device),
                fields: [
                    {
                        key: 'action',
                        label: _("Action"),
                        type: 'select',
                        defaultValue: 'start',
                        options: ['start', 'cancel', 'suspend'].map(a => ({ value: a, label: ACTION_FIELDS[a] })),
                    },
                    { key: 'secure', label: _("Secure TRIM (-d)"), type: 'switch' },
                    { key: 'rate', label: _("Rate limit (-r)"), type: 'text', placeholder: '512M' },
                ],
                onSubmit: v => svc.poolTrim({
                    pool: name,
                    devices: [device],
                    action: v.action as 'start',
                    secure: Boolean(v.secure),
                    ...defined({ rate: String(v.rate ?? '').trim() || undefined }),
                }),
            }),
        },
        {
            id: 'initialize',
            group: _("Maintenance"),
            label: _("Initialize…"),
            ...gated('zpool.initialize'),
            onSelect: () => open.openForm({
                title: cockpit.format(_("Initialize device $0"), device),
                fields: [{
                    key: 'action',
                    label: _("Action"),
                    type: 'select',
                    defaultValue: 'start',
                    options: ['start', 'cancel', 'suspend', 'unmonitor'].map(a => ({ value: a, label: ACTION_FIELDS[a] })),
                }],
                onSubmit: v => svc.poolInitialize({
                    pool: name,
                    devices: [device],
                    action: v.action as 'start',
                }),
            }),
        },
        {
            id: 'copy-name',
            group: _("Inspect"),
            label: _("Copy device name"),
            onSelect: () => { navigator.clipboard?.writeText(device)?.catch(() => undefined) },
        },
    ];
}
