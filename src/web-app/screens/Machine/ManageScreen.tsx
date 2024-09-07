import { AnchorButton, HTMLTable, Intent, NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";

import { Connector, ContainerEngine, PodmanMachine } from "@/env/Types";
import { AppLabel } from "@/web-app/components/AppLabel";
import { AppScreenHeader } from "@/web-app/components/AppScreenHeader";
import { useAppScreenSearch } from "@/web-app/components/AppScreenHooks";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { usePoller } from "@/web-app/Hooks";
import { AppScreen, AppScreenProps } from "@/web-app/Types";

import { ActionsMenu } from ".";
import "./ManageScreen.css";
import { getMachineUrl } from "./Navigation";

export const ID = "machines";

export interface ScreenProps extends AppScreenProps {}
export const Screen: AppScreen<ScreenProps> = () => {
  const { searchTerm, onSearchChange } = useAppScreenSearch();
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const machinesFetch = useStoreActions((actions) => actions.machine.machinesFetch);
  const machines: PodmanMachine[] = useStoreState((state) => state.machine.machinesSearchByTerm(searchTerm));

  // Change hydration
  usePoller({ poller: machinesFetch });

  return (
    <div className="AppScreen" data-screen={ID}>
      <AppScreenHeader searchTerm={searchTerm} onSearch={onSearchChange} titleIcon={IconNames.HEAT_GRID} rightContent={<ActionsMenu onReload={machinesFetch} />} />
      <div className="AppScreenContent">
        {machines.length === 0 && !pending ? (
          <NonIdealState icon={IconNames.GEOSEARCH} title={t("No results")} description={<p>{t("There are no machines")}</p>} />
        ) : (
          <HTMLTable interactive compact striped className="AppDataTable" data-table="machines">
            <thead>
              <tr>
                <th data-column="Name">
                  <AppLabel iconName={IconNames.HEAT_GRID} text={t("Name")} />
                </th>
                <th data-column="VMType">{t("VM Type")}</th>
                <th data-column="Active">{t("Active")}</th>
                <th data-column="Running">{t("Running")}</th>
                <th data-column="LastUp">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("titleBarStyle")} />
                </th>
                <th data-column="Created">
                  <AppLabel iconName={IconNames.CALENDAR} text={t("Created")} />
                </th>
                <th data-column="Actions">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((machine) => {
                return (
                  <tr key={machine.Name}>
                    <td>
                      <AnchorButton className="InspectMachineButton" minimal small href={getMachineUrl(machine.Name, "inspect")} intent={Intent.PRIMARY} icon={IconNames.EYE_OPEN}>
                        <span>{machine.Name}</span>
                      </AnchorButton>
                    </td>
                    <td>{machine.VMType}</td>
                    <td>{machine.Active ? t("Yes") : t("No")}</td>
                    <td>{machine.Running ? t("Yes") : t("No")}</td>
                    <td>{dayjs(machine.LastUp).format("DD MMM YYYY HH:mm")}</td>
                    <td>{dayjs(machine.Created).format("DD MMM YYYY HH:mm")}</td>
                    <td>
                      <ActionsMenu withoutCreate machine={machine} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </HTMLTable>
        )}
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = "Machines";
Screen.Route = {
  Path: `/screens/${ID}`
};
Screen.Metadata = {
  LeftIcon: IconNames.HEAT_GRID
};
Screen.isAvailable = (currentConnector?: Connector) => {
  const isDocker = (currentConnector?.engine || "").startsWith("docker");
  const isPodmanWSL = currentConnector?.engine === ContainerEngine.PODMAN_VIRTUALIZED_WSL;
  return !(isDocker || isPodmanWSL);
};
