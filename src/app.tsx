import React from 'react';
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";

import cockpit from 'cockpit';

const _ = cockpit.gettext;

// Placeholder shell: the Pools/Datasets/Events/Command log/Settings UI lands in
// later waves (see plan.md Improve). No src/service.ts or src/components/ imports here.
export const Application = () => {
    return (
        <Page sidebar={null} className="zfs-page ct-page-fill" mainAriaLabel={_("ZFS")}>
            <PageSection isFilled={false} className="zfs-page-header">
                <Title headingLevel="h1" size="xl">{_("ZFS Manager")}</Title>
            </PageSection>
            <PageSection>
                <Content component="p">{_("Pool and dataset management UI is under construction.")}</Content>
            </PageSection>
        </Page>
    );
};
