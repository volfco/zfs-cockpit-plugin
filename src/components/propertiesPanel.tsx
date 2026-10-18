import React from 'react';
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import cockpit from 'cockpit';

import { useDialogs } from './actions';
import { type FieldDef } from './dialogs';
import * as svc from '../service';
import type { DatasetProperty } from '../types';

const _ = cockpit.gettext;

// ---------------------------------------------------------------------------
// Generic dataset property editor — renders EVERYTHING `zfs get -H all`
// returns and drives `zfs set`/`zfs inherit` for it. No hardcoded property
// list: user and plugin properties (org.openzfs:*) come through the same
// table via the free-text "Set property…" action.
// ---------------------------------------------------------------------------

// Properties ZFS computes and refuses to set. Read-only is also detected from
// the source column ("-"), covering future computed properties.
const READONLY_PROPS = new Set([
    'type', 'creation', 'createtxg', 'used', 'available', 'referenced', 'refer',
    'compressratio', 'mounted', 'usedbysnapshots', 'usedbydataset',
    'usedbyrefreservation', 'usedbychildren', 'logicalreferenced', 'logicalused',
    'written', 'keystatus', 'encryptionroot', 'userrefs', 'objset', 'inconsistent',
    'defer_destroy', 'snapshots', 'snapshot_count', 'snapshot_list',
]);

// Numeric properties whose values accept size suffixes (K/M/G/T/P); the edit
// helper says so instead of rejecting plain bytes.
const SIZE_PROPS = new Set([
    'volsize', 'volblocksize', 'recordsize', 'quota', 'refquota', 'reservation',
    'refreservation', 'logbias', 'special_small_blocks',
]);

function isReadonly(p: DatasetProperty): boolean {
    return p.source === '-' || p.source === '—' || READONLY_PROPS.has(p.name);
}

// Value editors: boolean-ish properties get an on/off select, everything else
// plain text (numeric/size properties carry a suffix hint).
function valueField(p: DatasetProperty): FieldDef {
    if (p.value === 'on' || p.value === 'off') {
        return {
            key: 'value',
            label: _("Value"),
            type: 'select',
            required: true,
            defaultValue: p.value,
            options: [
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
            ],
        };
    }
    const field: FieldDef = {
        key: 'value',
        label: _("Value"),
        type: 'text',
        required: true,
        defaultValue: p.value,
    };
    if (SIZE_PROPS.has(p.name)) field.helper = _("Numeric value; sizes accept suffixes like K, M, G, T, P.");
    return field;
}

export function PropertiesPanel({ target, reloadKey, onChanged }: {
    target: string;
    reloadKey: number;
    onChanged: () => void;
}) {
    const [props, setProps] = React.useState<DatasetProperty[] | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [filter, setFilter] = React.useState('');

    const load = React.useCallback(() => {
        svc.fetchDatasetProperties(target)
                .then(rows => {
                    setProps(rows);
                    setError(null);
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }, [target]);

    React.useEffect(() => {
        load();
    }, [load, reloadKey]);

    // Dialog success keeps the dialog mounted (it shows the command output);
    // the parent bumps reloadKey, which refetches this table.
    const dialogs = useDialogs(onChanged);

    const inherit = (property: string, revert: boolean) => {
        setError(null);
        svc.dsInherit({ property, targets: target, revert })
                .then(() => {
                    load();
                    onChanged();
                })
                .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    };

    const edit = (p: DatasetProperty) => dialogs.openForm({
        title: cockpit.format(_("Set $0 on $1"), p.name, target),
        description: cockpit.format(_("Current value: $0 (source: $1)"), p.value, p.source),
        fields: [valueField(p)],
        onSubmit: v => svc.dsSet({
            properties: { [p.name]: String(v.value ?? '') },
            targets: target,
        }),
    });

    const rows = (props ?? []).filter(p => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
    const label = cockpit.format(_("Properties of $0"), target);

    return (
        <>
            <Flex spaceItems={{ default: 'spaceItemsSm' }} className="pf-v6-u-mb-sm">
                <FlexItem>
                    <Button
variant="secondary" onClick={() => dialogs.openForm({
    title: cockpit.format(_("Set property on $0"), target),
    description: _("Covers all ZFS properties, including user and plugin properties like org.openzfs:*."),
    fields: [
        {
            key: 'property',
            label: _("Property"),
            type: 'text',
            required: true,
            placeholder: 'compression',
            helper: _("Any property name accepted by zfs set."),
        },
        { key: 'value', label: _("Value"), type: 'text', required: true },
    ],
    onSubmit: v => svc.dsSet({
        properties: { [String(v.property)]: String(v.value) },
        targets: target,
    }),
})}
                    >
                        {_("Set property…")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <Button
variant="secondary" onClick={() => dialogs.openForm({
    title: cockpit.format(_("Inherit property on $0"), target),
    fields: [{
        key: 'property',
        label: _("Property"),
        type: 'text',
        required: true,
        placeholder: 'compression',
    }],
    onSubmit: v => svc.dsInherit({ property: String(v.property), targets: target }),
})}
                    >
                        {_("Inherit property…")}
                    </Button>
                </FlexItem>
                <FlexItem>
                    <TextInput
                        aria-label={_("Filter properties")}
                        placeholder={_("Filter properties")}
                        value={filter}
                        onChange={(_e, v) => setFilter(v)}
                    />
                </FlexItem>
            </Flex>

            {error && (
                <Alert variant="danger" title={_("Command failed")} isInline className="pf-v6-u-mb-sm">
                    {error}
                </Alert>
            )}
            {!props && !error && <span className="pf-v6-u-color-200">{_("Loading…")}</span>}
            {props && (
                <div className="zfs-table-region" role="region" aria-label={label} tabIndex={0}>
                    <table className="pf-v6-c-table pf-m-compact pf-m-grid-lg" aria-label={label}>
                        <caption className="pf-v6-u-screen-reader">{label}</caption>
                        <thead className="pf-v6-c-table__thead">
                            <tr className="pf-v6-c-table__tr">
                                <th className="pf-v6-c-table__th" scope="col">{_("Property")}</th>
                                <th className="pf-v6-c-table__th" scope="col">{_("Value")}</th>
                                <th className="pf-v6-c-table__th" scope="col">{_("Source")}</th>
                                <th className="pf-v6-c-table__th" scope="col" />
                            </tr>
                        </thead>
                        <tbody className="pf-v6-c-table__tbody">
                            {rows.map(p => (
                                <tr className="pf-v6-c-table__tr" key={p.name}>
                                    <th className="pf-v6-c-table__th" scope="row" data-label={_("Property")}>{p.name}</th>
                                    <td className="pf-v6-c-table__td" data-label={_("Value")}>
                                        <span className="zfs-setting-value">{p.value}</span>
                                    </td>
                                    <td className="pf-v6-c-table__td" data-label={_("Source")}>
                                        {p.source || '—'}
                                        {p.received && p.received !== '-' && (
                                            <span className="pf-v6-u-color-200 pf-v6-u-font-size-sm">
                                                {cockpit.format(_(" (received: $0)"), p.received)}
                                            </span>
                                        )}
                                    </td>
                                    <td className="pf-v6-c-table__td zfs-row-actions">
                                        {isReadonly(p)
                                            ? <Label color="grey">{_("read-only")}</Label>
                                            : (
                                                <Flex spaceItems={{ default: 'spaceItemsSm' }} justifyContent={{ default: 'justifyContentFlexEnd' }}>
                                                    <Button
                                                        variant="link"
                                                        isInline
                                                        onClick={() => edit(p)}
                                                    >
                                                        {_("Edit…")}
                                                    </Button>
                                                    <Button
                                                        variant="link"
                                                        isInline
                                                        onClick={() => inherit(p.name, false)}
                                                    >
                                                        {_("Inherit")}
                                                    </Button>
                                                    {p.source === 'received' && (
                                                        <Button
                                                            variant="link"
                                                            isInline
                                                            onClick={() => inherit(p.name, true)}
                                                        >
                                                            {_("Revert to received")}
                                                        </Button>
                                                    )}
                                                </Flex>
                                            )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {dialogs.node}
        </>
    );
}
