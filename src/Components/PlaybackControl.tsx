import React, { MouseEventHandler, useEffect, useReducer } from "react";
import { controller } from "../Controller/Controller";
import {
	ButtonIndicator,
	Clickable,
	ContentNode,
	Expandable,
	Help,
	Input,
	ValueChangeEvent,
} from "./Common";
import {
	getCachedValue,
	setCachedValue,
	ShellInfo,
	ShellVersion,
	TickMode,
} from "../Controller/Common";
import { LevelSync, ProcMode } from "../Game/Common";
import { getAllResources, getResourceInfo, ResourceOverrideData } from "../Game/Resources";
import { localize, localizeResourceType } from "./Localization";
import {
	getThemeField,
	getThemeColors,
	getCurrentThemeColors,
	ColorThemeContext,
} from "./ColorTheme";
import { SerializedConfig, GameConfig, DEFAULT_CONFIG } from "../Game/GameConfig";
import { XIVMath } from "../Game/XIVMath";
import { FaCheck } from "react-icons/fa6";
import {
	ShellJob,
	JOBS,
	ImplementationKey,
	CASTER_JOBS,
	HEALER_JOBS,
	ALL_JOBS,
	IMPLEMENTATION_LEVELS,
} from "../Game/Data/Jobs";
import { ResourceKey, CooldownKey } from "../Game/Data";
import { getGameState } from "../Game/Jobs";

export let updateConfigDisplay = (config: SerializedConfig) => {};

function getTableStyle(bgHighContrastColor: string) {
	return `
		table {
			border-collapse: collapse;
			width: 100%;
		}
		th, td {
			text-align: center;
			padding: 0.15em;
			border: 1px solid ${bgHighContrastColor};
			width: 33%
		}
	`;
}

// key, rscType, rscInfo
export function ResourceOverrideDisplay(props: {
	job: ShellJob;
	override: ResourceOverrideData;
	deleteFn?: (rsc: ResourceKey | CooldownKey) => void; // when null, this component is for display only
}) {
	const rscInfo = getResourceInfo(props.job, props.override.type);
	let str: ContentNode;
	const localizedRsc = localizeResourceType(props.override.type);
	if (rscInfo.isCoolDown) {
		str = localize({
			en: localizedRsc + " full in " + props.override.timeTillFullOrDrop + "s",
			zh: `${localizedRsc}将在${props.override.timeTillFullOrDrop}秒后转好`,
		});
	} else {
		str = localizedRsc;
		const lparen = localize({ en: " (", zh: "（" }) as string;
		const rparen = localize({ en: ") ", zh: "）" }) as string;
		//const colon = localize({en: ": ", zh: "："}) as string;
		if (props.override.type === "LEY_LINES") {
			str +=
				lparen +
				(props.override.effectOrTimerEnabled
					? localize({ en: "enabled", zh: "生效中" })
					: localize({ en: "disabled", zh: "未生效" })) +
				rparen;
		}
		if (rscInfo.maxValue > 1) {
			str += localize({
				en: ` (amount: ${props.override.stacks})`,
				zh: `（数量：${props.override.stacks}）`,
			});
		}
		if (rscInfo.maxTimeout >= 0) {
			if (props.override.type === "POLYGLOT") {
				if (props.override.timeTillFullOrDrop > 0) {
					str += localize({
						en: ` next stack ready in ${props.override.timeTillFullOrDrop}s`,
						zh: `距下一层${props.override.timeTillFullOrDrop}秒`,
					});
				}
			} else {
				if (props.override.effectOrTimerEnabled) {
					str += localize({
						en: ` drops in ${props.override.timeTillFullOrDrop}s`,
						zh: `将在${props.override.timeTillFullOrDrop}秒后消失`,
					});
				}
			}
		}
	}
	str += " ";
	let deleteBtn: React.JSX.Element | undefined = undefined;
	if (props.deleteFn) {
		const deleteFn = props.deleteFn;
		deleteBtn = <Clickable
			content="[x]"
			onClickFn={(e) => {
				deleteFn(props.override.type);
			}}
		/>;
	}
	return <div style={{ marginTop: 10, color: "mediumpurple" }}>
		{str}
		{deleteBtn}
	</div>;
}

let refreshConfigSummary = () => {};
export function ConfigSummary(props: { job: ShellJob; dirty: boolean }) {
	const [, forceUpdate] = useReducer((x) => x + 1, 0);
	useEffect(() => {
		refreshConfigSummary = forceUpdate;
		return () => {
			refreshConfigSummary = () => {};
		};
	}, []);

	const lucidTickOffset = controller.game.lucidTickOffset.toFixed(3);
	const lucidOffsetDesc = localize({
		en: "the random time offset of lucid dreaming ticks relative to mp ticks",
		zh: "醒梦buff期间，每次跳蓝后多久跳醒梦（由随机种子决定）",
	});
	// TODO specialize for BLM
	// TODO (revisit): double check this forced cast
	const dotTickOffset = controller.game.dotTickOffset.toFixed(3);
	const offsetDesc = localize({
		en: "the random time offset of DoT ticks relative to mp ticks",
		zh: "雷DoT期间，每次跳蓝后多久跳雷（由随机种子决定）", // Akairyu's Note - Needs retranslating after removing the reference to thunder
	});
	const procMode = controller.gameConfig.procMode;
	const numOverrides = controller.gameConfig.initialResourceOverrides.length;
	const legacyCasterTax = controller.gameConfig.legacy_casterTax;
	const excerpt = localize({
		en: `WARNING: this record was created in an earlier version of XIV in the Shell and uses the deprecated caster tax of ${legacyCasterTax}s instead of calculating from your FPS input below. Hover for details: `,
		zh: `警告：此时间轴文件创建于一个更早版本的排轴器，因此计算读条时间时使用的是当时手动输入的读条税${legacyCasterTax}秒（现已过时），而非由下方的“帧率”和“读条时间修正”计算得来。更多信息：`,
	});
	const warningColor = getCurrentThemeColors().warning;
	const tryGetImplementationWarning = (impl: ImplementationKey, warningColor: string) => {
		const details = IMPLEMENTATION_LEVELS[impl];
		if (!details.warningContent) {
			return;
		}
		return <p
			style={{
				color: warningColor,
			}}
		>
			{localize(details.warningContent)}
		</p>;
	};

	const legacyCasterTaxBlurbContent = localize({
		en: <div>
			<div className={"paragraph"}>
				The caster tax config is now replaced by 0.1s + FPS tax and is more precise. You can
				read more about FPS tax in the Github repository wiki's implementation notes
				section.
			</div>
			<div className={"paragraph"} style={{ color: warningColor }}>
				You are strongly encouraged to create a new record (in another timeline slot or from
				'apply and reset') and migrate your fight plan. Support for loading legacy files
				might drop in the future.
			</div>
		</div>,
		zh: <div>
			<div className={"paragraph"}>
				现在的“读条税”由固定的0.1s加自动计算的帧率税构成，模拟结果也更精确。有关帧率税的更多信息详见
				关于/实现细节。
			</div>
			<div className={"paragraph"} style={{ color: warningColor }}>
				排轴器今后的更新可能会导致无法加载过时的文件，所以强烈建议将此时间轴迁移到一个新建的存档中（添加时间轴，或者应用并重置时间轴）。
			</div>
		</div>,
	});
	const legacyCasterTaxBlurb = <p style={{ color: warningColor }}>
		{excerpt}
		<Help topic={"legacy-caster-tax"} content={legacyCasterTaxBlurbContent} />
	</p>;
	return <div
		style={{
			textDecoration: props.dirty ? "line-through" : "none",
			marginLeft: 5,
			paddingLeft: 10,
			borderLeft: "1px solid " + getCurrentThemeColors().bgHighContrast,
		}}
	>
		{controller.gameConfig.shellVersion < ShellVersion.FpsTax
			? legacyCasterTaxBlurb
			: undefined}

		{tryGetImplementationWarning(JOBS[props.job].implementationLevel, warningColor)}

		{/* TODO: refactor these out to job props classes */}
		{[...CASTER_JOBS, ...HEALER_JOBS].includes(props.job) && <div>
			{localize({ en: "Lucid tick offset ", zh: "醒梦&跳蓝时间差 " })}
			<Help topic={"lucidTickOffset"} content={lucidOffsetDesc} />: {lucidTickOffset}
		</div>}

		{/* Akairyu's Note: Needs retranslating after removing reference to Thunder*/}
		{controller.game.dotResources.length > 0 && <div>
			{localize({ en: "DoT tick offset ", zh: "跳雷&跳蓝时间差 " })}
			<Help topic={"dotTickOffset"} content={offsetDesc} />: {dotTickOffset}
		</div>}

		{props.job === "MNK" && <div>
			{localize({ en: "SSS GCD", zh: "六合星GCD" })}:{" "}
			{controller.gameConfig
				.adjustedSksGCD(5, controller.game.inherentSpeedModifier())
				.toFixed(2)}
		</div>}

		<p>
			{localize({ en: "Procs", zh: "随机数模式" })}: {procMode}
		</p>

		{numOverrides > 0 && <p>
			{localize({
				en: `${numOverrides} initial resource override(s)`,
				zh: `${numOverrides}项初始资源覆盖`,
			})}
		</p>}
	</div>;
}

type TimeControlState = {
	timeScale: number;
	tickMode: TickMode;
};

export class TimeControl extends React.Component {
	state: TimeControlState;
	setTickMode: (e: ValueChangeEvent) => void;
	setTimeScale: (s: string) => void;
	loadSettings: () => TimeControlState | undefined;
	saveSettings: (settings: TimeControlState) => void;

	constructor(props: {}) {
		super(props);

		this.saveSettings = (settings: TimeControlState) => {
			const str = JSON.stringify({
				tickMode: settings.tickMode,
				timeScale: settings.timeScale,
			});
			setCachedValue("playbackSettings", str);
		};

		this.loadSettings = () => {
			const str = getCachedValue("playbackSettings");
			if (str) {
				const settings: TimeControlState = JSON.parse(str);
				return settings;
			}
			return undefined;
		};

		this.setTickMode = (e: ValueChangeEvent) => {
			if (!e || !e.target || isNaN(parseInt(e.target.value))) return;
			this.setState({ tickMode: parseInt(e.target.value) });
			const numVal = parseInt(e.target.value);
			if (!isNaN(numVal)) {
				controller.setTimeControlSettings({
					tickMode: numVal,
					timeScale: this.state.timeScale,
				});
				this.saveSettings({
					tickMode: numVal,
					timeScale: this.state.timeScale,
				});
			}
		};

		this.setTimeScale = (val: string) => {
			this.setState({ timeScale: val });
			const numVal = parseFloat(val);
			if (!isNaN(numVal)) {
				controller.setTimeControlSettings({
					tickMode: this.state.tickMode,
					timeScale: numVal,
				});
				this.saveSettings({
					tickMode: this.state.tickMode,
					timeScale: numVal,
				});
			}
		};

		const settings = this.loadSettings();
		if (settings) {
			this.state = {
				tickMode: settings.tickMode,
				timeScale: settings.timeScale,
			};
		} else {
			this.state = {
				tickMode: 1,
				timeScale: 2,
			};
		}
	}
	componentDidMount() {
		controller.setTimeControlSettings({
			tickMode: this.state.tickMode,
			timeScale: this.state.timeScale,
		});
	}
	render() {
		const radioStyle: React.CSSProperties = {
			position: "relative",
			top: 3,
			marginRight: "0.75em",
		};
		const tickModeOptionStyle = {
			display: "inline-block",
			marginRight: "0.5em",
		};
		return <div>
			<p>
				<label style={tickModeOptionStyle}>
					<input
						style={radioStyle}
						type={"radio"}
						onChange={this.setTickMode}
						value={TickMode.RealTimeAutoPause}
						checked={this.state.tickMode === TickMode.RealTimeAutoPause}
						name={"tick mode"}
					/>
					{localize({
						en: "real-time auto pause",
						zh: "实时(带自动暂停）",
					})}
				</label>
				<Help
					topic={"ctrl-realTimeAutoPause"}
					content={
						<div className="toolTip">
							{localize({
								en: <div className="paragraph">*Recommended*</div>,
								zh: <div className="paragraph">*推荐设置*</div>,
							})}
							{localize({
								en: <div className="paragraph">
									- click to use a skill. if the skill is on cooldown, or you're
									in an animation lock, then the simulation will automatically
									skip ahead to when the skill can be used again
									<br />- animation locks and cast bars will play out in sped-up
									real time until done
								</div>,
								zh: <div className="paragraph">
									- 点击图标使用技能;
									战斗时间会按下方设置的倍速自动前进直到可释放下一个技能。如果点击的技能CD没有转好，模拟会自动地快进到它CD转好并重试。
								</div>,
							})}
						</div>
					}
				/>
				<br />
				<label style={tickModeOptionStyle}>
					<input
						style={radioStyle}
						type={"radio"}
						onChange={this.setTickMode}
						value={TickMode.Manual}
						checked={this.state.tickMode === TickMode.Manual}
						name={"tick mode"}
					/>
					{localize({
						en: "manual",
						zh: "手动",
					})}
				</label>
				<Help
					topic={"ctrl-manual"}
					content={
						<div className="toolTip">
							{localize({
								en: <div className="paragraph">
									- click to use a skill. if the skill is on cooldown, or you're
									in an animation lock, then the simulation will automatically
									skip ahead to when the skill can be used again
									<br />- animation locks and cast times are skipped immediately
								</div>,
								zh: <div className="paragraph">
									- 点击图标使用技能;
									战斗时间会自动快进至可释放下一个技能。如果点击的技能CD没有转好，模拟会自动地快进到它CD转好并重试。
								</div>,
							})}
						</div>
					}
				/>
			</p>
			<Input
				defaultValue={`${this.state.timeScale}`}
				description={
					<span>
						{localize({ en: "time scale ", zh: "倍速 " })}
						<Help
							topic={"timeScale"}
							content={
								<div>
									{localize({
										en: "rate at which game time advances automatically (aka when in real-time)",
										zh: "战斗时间自动前进的速度",
									})}
								</div>
							}
						/>
						:{" "}
					</span>
				}
				onChange={this.setTimeScale}
			/>
		</div>;
	}
}

// states are mostly strings here because those inputs are controlled by <Input ... />
type ConfigState = {
	job: ShellJob;
	shellVersion: ShellVersion;

	gearImportLink: string;
	imported: boolean;
	importedFields: string[];

	level: string;
	spellSpeed: string;
	skillSpeed: string;
	criticalHit: string;
	directHit: string;
	determination: string;
	piety: string;
	animationLock: string;
	fps: string;
	gcdSkillCorrection: string;
	timeTillFirstManaTick: string;
	countdown: string;
	randomSeed: string;
	procMode: ProcMode;
	initialResourceOverrides: ResourceOverrideData[];

	selectedOverrideResource: ResourceKey | CooldownKey;
	overrideTimer: string;
	overrideStacks: string;
	overrideEnabled: boolean;

	dirty: boolean;
	gcdPreview: string;
	taxedGcdPreview: string;
	sksGcdPreview: string;
	taxedSksGcdPreview: string;
};

export class Config extends React.Component {
	state: ConfigState;
	updateTaxPreview: (spsStr: string, fpsStr: string, levelStr: string) => void;
	updateSksTaxPreview: (sksStr: string, fpsStr: string, levelStr: string) => void;
	handleSubmit: MouseEventHandler;

	setJob: (evt: React.ChangeEvent<HTMLSelectElement>) => void;
	importGear: (evt: React.SyntheticEvent) => void;
	setGearImportLink: (evt: React.ChangeEvent<HTMLInputElement>) => void;
	setSpellSpeed: (val: string) => void;
	setSkillSpeed: (val: string) => void;
	setLevel: (evt: React.ChangeEvent<HTMLSelectElement>) => void;
	setCriticalHit: (val: string) => void;
	setDirectHit: (val: string) => void;
	setDetermination: (val: string) => void;
	setPiety: (val: string) => void;
	setAnimationLock: (val: string) => void;
	setFps: (val: string) => void;
	setGcdSkillCorrection: (val: string) => void;
	setTimeTillFirstManaTick: (val: string) => void;
	setCountdown: (val: string) => void;
	setRandomSeed: (val: string) => void;
	setProcMode: (evt: React.ChangeEvent<HTMLSelectElement>) => void;
	setOverrideTimer: (val: string) => void;
	setOverrideStacks: (val: string) => void;
	setOverrideEnabled: (evt: React.ChangeEvent<{ checked: boolean }>) => void;
	deleteResourceOverride: (rsc: ResourceKey | CooldownKey) => void;
	removeImportedField: (field: string) => void;

	static contextType = ColorThemeContext;

	constructor(props: {}) {
		super(props);
		this.state = {
			// NOT DEFAULTS
			job: "BLM",
			shellVersion: ShellInfo.version,
			gearImportLink: "",
			imported: false,
			importedFields: [],
			/////////
			level: `${LevelSync.lvl100}`,
			spellSpeed: "0",
			skillSpeed: "0",
			criticalHit: "0",
			directHit: "0",
			determination: "0",
			piety: "0",
			animationLock: "0",
			fps: "0",
			gcdSkillCorrection: "0",
			timeTillFirstManaTick: "0",
			countdown: "0",
			randomSeed: "",
			procMode: ProcMode.RNG,
			initialResourceOverrides: [],
			/////////
			selectedOverrideResource: "MANA",
			overrideTimer: "0",
			overrideStacks: "0",
			overrideEnabled: true,
			/////////
			dirty: false,
			gcdPreview: "n/a",
			taxedGcdPreview: "n/a",
			sksGcdPreview: "n/a",
			taxedSksGcdPreview: "n/a",
		};

		this.updateTaxPreview = (spsStr: string, fpsStr: string, levelStr: string) => {
			const { gcdStr, taxedGcdStr } = this.getGcdTaxPreview(spsStr, fpsStr, levelStr);

			this.setState({
				gcdPreview: gcdStr,
				taxedGcdPreview: taxedGcdStr,
			});
		};

		this.updateSksTaxPreview = (sksStr: string, fpsStr: string, levelStr: string) => {
			// TODO: This code does not correctly apply new haste modifiers if the job is changed.
			const { gcdStr, taxedGcdStr } = this.getGcdTaxPreview(
				sksStr,
				fpsStr,
				levelStr,
				this.getSpeedModifier(),
			);

			this.setState({
				sksGcdPreview: gcdStr,
				taxedSksGcdPreview: taxedGcdStr,
			});
		};

		this.handleSubmit = (event: React.SyntheticEvent) => {
			if (this.#resourceOverridesAreValid()) {
				let seed = this.state.randomSeed;
				if (seed.length === 0) {
					for (let i = 0; i < 4; i++) {
						seed += Math.floor(Math.random() * 10).toString();
					}
					this.setState({ randomSeed: seed });
				}
				const config = { ...this.state, ...{ randomSeed: seed } };
				this.setConfigAndRestart(config);
				this.setState({ dirty: false, imported: false, importedFields: [] });
				controller.scrollToTime();
			}
			event.preventDefault();
		};

		this.setJob = (evt) => {
			// Reset all resource overrides
			if (evt.target.value !== this.state.job) {
				this.setState({ initialResourceOverrides: [], dirty: true });
			}
			this.setState({ job: evt.target.value, dirty: true });
			this.removeImportedField("job");
			this.updateTaxPreview(this.state.spellSpeed, this.state.fps, this.state.level);
			this.updateSksTaxPreview(this.state.skillSpeed, this.state.fps, this.state.level);
		};

		this.setGearImportLink = (evt: React.ChangeEvent<HTMLInputElement>) => {
			this.setState({ gearImportLink: evt.target.value });
		};

		this.importGear = async (event: React.SyntheticEvent) => {
			event.preventDefault();
			const url = URL.parse(this.state.gearImportLink);
			const headers = new Headers();
			try {
				if (url && url.hostname === "etro.gg") {
					const tokens = url.pathname.split("/");
					if (tokens[1] !== "gearset" && tokens.length !== 3) {
						throw new Error(
							"Invalid etro gearset link (hover ? in URL input box for details)",
						);
					}
					headers.append("Content-Type", "application/json");
					const response = await fetch("https://etro.gg/api/gearsets/" + tokens[2], {
						method: "GET",
						headers: headers,
					});
					if (response.ok) {
						const body: any = await response.json();
						const stats = new Map<string, string>(
							body["totalParams"].map((obj: any) => [obj["name"], obj["value"]]),
						);
						if (!(body["jobAbbrev"] in JOBS)) {
							throw new Error(
								"Imported gearset was for a job (" +
									body["jobAbbrev"] +
									") that XIV in the Shell doesn't support",
							);
						}
						// TODO should probably validate each of these fields
						const baseSpeed = XIVMath.getSubstatBase(
							parseFloat(body["level"]) as LevelSync,
						).toString();
						const spellSpeed = stats.get("SPS") ?? baseSpeed;
						const skillSpeed = stats.get("SKS") ?? baseSpeed;
						const importedFields = [
							"job",
							"level",
							"criticalHit",
							"directHit",
							"determination",
						];
						if (stats.has("SPS")) importedFields.push("spellSpeed");
						if (stats.has("SKS")) importedFields.push("skillSpeed");
						if (stats.has("PIE")) importedFields.push("piety");
						this.setState({
							job: body["jobAbbrev"],
							level: body["level"],
							spellSpeed,
							skillSpeed,
							criticalHit: stats.get("CRT"),
							directHit: stats.get("DH"),
							determination: stats.get("DET"),
							piety: stats.get("PIE"),
							imported: true,
							importedFields: importedFields,
							dirty: true,
						});
						this.updateTaxPreview(spellSpeed, this.state.fps, body["level"]);
						this.updateSksTaxPreview(skillSpeed, this.state.fps, body["level"]);
					} else {
						console.error(response);
						throw new Error("etro load failed (please check your link)");
					}
				} else if (url && url.hostname === "xivgear.app") {
					const pageParam = url.searchParams.get("page");
					if (!pageParam) {
						throw new Error(
							"xivgear link must be to a specific set (hover ? in URL input box for details)",
						);
					}
					// strip the "sl|" url-encoded characters at the start of the link
					const setId = pageParam.startsWith("sl|") ? pageParam.substr(3) : pageParam;
					headers.append("Content-Type", "application/json");
					const response = await fetch("https://api.xivgear.app/fulldata/" + setId, {
						method: "GET",
						headers: headers,
					});
					if (response.ok) {
						const body: any = await response.json();
						// TODO should probably validate each of these fields
						if (!(body["job"] in JOBS)) {
							throw new Error(
								"Imported gearset was for a job (" +
									body["job"] +
									") that XIV in the Shell doesn't support",
							);
						}
						const stats = body["sets"][0]["computedStats"];
						this.setState({
							job: body["job"],
							level: body["level"],
							spellSpeed: stats["spellspeed"],
							skillSpeed: stats["skillspeed"],
							criticalHit: stats["crit"],
							directHit: stats["dhit"],
							determination: stats["determination"],
							piety: stats["piety"],
							imported: true,
							importedFields: [
								"job",
								"level",
								"spellSpeed",
								"skillSpeed",
								"criticalHit",
								"directHit",
								"determination",
								"piety",
							],
							dirty: true,
						});
						this.updateTaxPreview(
							stats["spellspeed"]!.toString(),
							this.state.fps,
							body["level"],
						);
					} else {
						console.error("xivgear load failed: " + response);
						throw new Error("xivgear load failed (please check your link)");
					}
				} else {
					throw new Error("Invalid gearset link (must be from etro.gg or xivgear.app)");
				}
			} catch (e: any) {
				console.error(e);
				window.alert(e.message);
			}
		};

		this.setSpellSpeed = (val: string) => {
			this.setState({ spellSpeed: val, dirty: true });
			this.removeImportedField("spellSpeed");
			this.updateTaxPreview(val, this.state.fps, this.state.level);
		};

		this.setSkillSpeed = (val: string) => {
			this.setState({ skillSpeed: val, dirty: true });
			this.removeImportedField("skillSpeed");
			this.updateSksTaxPreview(val, this.state.fps, this.state.level);
		};

		this.setLevel = (evt) => {
			this.setState({ level: evt.target.value, dirty: true });
			this.removeImportedField("level");
			this.updateTaxPreview(this.state.spellSpeed, this.state.fps, evt.target.value);
			this.updateSksTaxPreview(this.state.skillSpeed, this.state.fps, this.state.level);
		};

		this.setCriticalHit = (val: string) => {
			this.setState({ criticalHit: val, dirty: true });
			this.removeImportedField("criticalHit");
		};

		this.setDirectHit = (val: string) => {
			this.setState({ directHit: val, dirty: true });
			this.removeImportedField("directHit");
		};

		this.setDetermination = (val: string) => {
			this.setState({ determination: val, dirty: true });
			this.removeImportedField("determination");
		};

		this.setPiety = (val: string) => {
			this.setState({ piety: val, dirty: true });
			this.removeImportedField("piety");
		};

		this.setAnimationLock = (val: string) => {
			this.setState({ animationLock: val, dirty: true });
		};

		this.setFps = (val: string) => {
			this.setState({ fps: val, dirty: true });
			this.updateTaxPreview(this.state.spellSpeed, val, this.state.level);
		};

		this.setGcdSkillCorrection = (val: string) => {
			this.setState({ gcdSkillCorrection: val, dirty: true });
		};

		this.setTimeTillFirstManaTick = (val: string) => {
			this.setState({ timeTillFirstManaTick: val, dirty: true });
		};

		this.setCountdown = (val: string) => {
			this.setState({ countdown: val, dirty: true });
		};

		this.setRandomSeed = (val: string) => {
			this.setState({ randomSeed: val, dirty: true });
		};

		this.setProcMode = (evt) => {
			this.setState({ procMode: evt.target.value, dirty: true });
		};

		this.setOverrideTimer = (val: string) => {
			this.setState({ overrideTimer: val });
		};
		this.setOverrideStacks = (val: string) => {
			this.setState({ overrideStacks: val });
		};
		this.setOverrideEnabled = (evt: React.ChangeEvent<{ checked: boolean }>) => {
			this.setState({ overrideEnabled: evt.target.checked });
		};
		this.deleteResourceOverride = (rscType: ResourceKey | CooldownKey) => {
			const overrides = this.state.initialResourceOverrides;
			for (let i = 0; i < overrides.length; i++) {
				if (overrides[i].type === rscType) {
					overrides.splice(i, 1);
					break;
				}
			}
			this.setState({ initialResourceOverrides: overrides, dirty: true });
		};
		this.removeImportedField = (field: string) => {
			const idx = this.state.importedFields.indexOf(field);
			if (idx >= 0) {
				const newFieldsArray = this.state.importedFields;
				newFieldsArray.splice(idx, 1);
				this.setState({ importedFields: newFieldsArray });
			}
		};
	}

	private getSpeedModifier(): number | undefined {
		const dummyConfig: GameConfig = new GameConfig({ ...DEFAULT_CONFIG, job: this.state.job });
		return getGameState(dummyConfig).inherentSpeedModifier();
	}

	private getDefaultGcd(base: number): number {
		const isSps =
			JOBS[this.state.job].role === "CASTER" || JOBS[this.state.job].role === "HEALER";
		return XIVMath.preTaxGcd(
			parseFloat(this.state.level) as LevelSync,
			isSps ? parseFloat(this.state.spellSpeed) : parseFloat(this.state.skillSpeed),
			base,
			this.getSpeedModifier(),
		);
	}

	private getDefaultGcdTax(base: number): number {
		// Returns the approxmiate duration of the GCD after applying innate haste buffs
		// and FPS adjustments.
		return XIVMath.afterFpsTax(parseFloat(this.state.fps), this.getDefaultGcd(base));
	}

	private getGcdTaxPreview(
		speedStr: string,
		fpsStr: string,
		levelStr: string,
		speedModifier?: number,
	): { gcdStr: string; taxedGcdStr: string } {
		const level = parseFloat(levelStr);
		const speed = parseFloat(speedStr);
		const fps = parseFloat(fpsStr);

		let gcdStr: string;
		let taxedGcdStr: string;
		if (isNaN(level) || isNaN(speed) || isNaN(fps) || speed < 400) {
			gcdStr = "n/a";
			taxedGcdStr = "n/a";
		} else {
			const gcd = XIVMath.preTaxGcd(level as LevelSync, speed, 2.5, speedModifier);
			gcdStr = gcd.toFixed(2);
			taxedGcdStr = XIVMath.afterFpsTax(fps, gcd).toFixed(3);
		}

		return {
			gcdStr,
			taxedGcdStr,
		};
	}

	// call this whenever the list of options has potentially changed
	#getFirstAddable(overridesList: ResourceOverrideData[]) {
		let firstAddableRsc = "aba aba";
		const S = new Set<ResourceKey | CooldownKey>();
		overridesList.forEach((ov) => {
			S.add(ov.type);
		});
		for (const k of getAllResources(this.state.job).keys()) {
			if (!S.has(k)) {
				firstAddableRsc = k;
				break;
			}
		}
		return firstAddableRsc;
	}

	componentDidMount() {
		updateConfigDisplay = (config) => {
			this.setState(config);
			const spsGcd = XIVMath.preTaxGcd(config.level, config.spellSpeed, 2.5);
			const { gcdStr: sksGcdPreview, taxedGcdStr: taxedSksGcdPreview } =
				this.getGcdTaxPreview(
					config.skillSpeed.toString(),
					config.fps.toString(),
					config.level.toString(),
					this.getSpeedModifier(),
				);
			this.setState({
				dirty: false,
				imported: false,
				importedFields: [],
				gcdPreview: spsGcd.toFixed(2),
				taxedGcdPreview: XIVMath.afterFpsTax(config.fps, spsGcd).toFixed(3),
				sksGcdPreview,
				taxedSksGcdPreview,
				selectedOverrideResource: this.#getFirstAddable(config.initialResourceOverrides),
			});
			refreshConfigSummary();
		};
	}

	#resourceOverridesAreValid() {
		// gather resources for quick access
		const M = new Map<ResourceKey | CooldownKey, ResourceOverrideData>();
		this.state.initialResourceOverrides.forEach((ov) => {
			M.set(ov.type, ov);
		});

		// shouldn't have AF and UI at the same time
		if (M.has("ASTRAL_FIRE") && M.has("UMBRAL_ICE")) {
			const af = M.get("ASTRAL_FIRE")!.stacks;
			const ui = M.get("UMBRAL_ICE")!.stacks;
			if (af > 0 && ui > 0) {
				window.alert("shouldn't have both AF and UI stacks");
				return false;
			}
		}

		let af = 0;
		let ui = 0;
		let uh = 0;
		if (M.has("ASTRAL_FIRE")) af = M.get("ASTRAL_FIRE")!.stacks;
		if (M.has("UMBRAL_ICE")) ui = M.get("UMBRAL_ICE")!.stacks;
		if (M.has("UMBRAL_HEART")) uh = M.get("UMBRAL_HEART")!.stacks;

		// if there's uh, must have AF/UI
		if (uh > 0) {
			if (af === 0 && ui === 0) {
				window.alert(
					"since there's at least one UH stack, there should also be Enochian and AF or UI",
				);
				return false;
			}
		}

		// if there are AF/UI stacks, implicitly grant enochian
		let hasEno = false;
		if (af > 0 || ui > 0 || uh > 0) {
			hasEno = true;
		}
		// if polyglot timer is set (>0), must have enochian
		if (M.has("POLYGLOT")) {
			const polyTimer = M.get("POLYGLOT")!.timeTillFullOrDrop;
			if (polyTimer > 0 && !hasEno) {
				window.alert(
					"since a timer for polyglot is set (time till next stack > 0), there must also be AF/UI",
				);
				return false;
			}
		}

		return true;
	}

	#addResourceOverride() {
		const rscType = this.state.selectedOverrideResource;
		const info = getAllResources(this.state.job).get(rscType)!;

		let inputOverrideTimer = parseFloat(this.state.overrideTimer);
		const inputOverrideStacks = parseInt(this.state.overrideStacks);
		const inputOverrideEnabled = this.state.overrideEnabled;

		// an exception for polyglot: leave empty := no timer set
		if (rscType === "POLYGLOT" && this.state.overrideTimer === "") {
			inputOverrideTimer = 0;
		}

		if (isNaN(inputOverrideStacks) || isNaN(inputOverrideTimer)) {
			window.alert("some inputs are not numbers!");
			return;
		}

		let props: ResourceOverrideData;

		if (info.isCoolDown) {
			const maxTimer = info.maxStacks * info.cdPerStack;
			if (inputOverrideTimer < 0 || inputOverrideTimer > maxTimer) {
				window.alert("invalid input timeout (must be in range [0, " + maxTimer + "])");
				return;
			}

			props = {
				type: rscType,
				timeTillFullOrDrop: inputOverrideTimer,
				stacks: info.maxStacks > 1 ? inputOverrideStacks : 1,
				effectOrTimerEnabled: true,
			};
		} else {
			if (
				(info.maxValue > 1 || info.maxValue === info.defaultValue) &&
				rscType !== "PARADOX" &&
				(inputOverrideStacks < 0 || inputOverrideStacks > info.maxValue)
			) {
				window.alert("invalid input amount (must be in range [0, " + info.maxValue + "])");
				return;
			}
			if (
				info.maxTimeout >= 0 &&
				(inputOverrideTimer < 0 || inputOverrideTimer > info.maxTimeout)
			) {
				window.alert(
					"invalid input timeout (must be in range [0, " + info.maxTimeout + "])",
				);
				return;
			}

			props = {
				type: rscType,
				timeTillFullOrDrop: info.maxTimeout >= 0 ? inputOverrideTimer : -1,
				stacks:
					info.maxValue > 1 || info.maxValue === info.defaultValue
						? inputOverrideStacks
						: 1,
				effectOrTimerEnabled: rscType === "LEY_LINES" ? inputOverrideEnabled : true,
			};
		}
		// end validation

		const overrides = this.state.initialResourceOverrides;
		overrides.push(props);
		this.setState({ initialResourceOverrides: overrides, dirty: true });
	}

	#addResourceOverrideNode() {
		const resourceInfos = getAllResources(this.state.job);
		const S = new Set();
		this.state.initialResourceOverrides.forEach((override) => {
			S.add(override.type);
		});

		const optionEntries: { rsc: ResourceKey | CooldownKey; isCoolDown: number }[] = [];
		for (const k of resourceInfos.keys()) {
			if (!S.has(k)) {
				optionEntries.push({
					rsc: k,
					isCoolDown: resourceInfos.get(k)!.isCoolDown ? 1 : 0,
				});
			}
		}
		const resourceOptions = optionEntries
			.sort((a, b) => {
				return a.isCoolDown - b.isCoolDown;
			})
			.map((opt, i) => {
				return <option key={i} value={opt.rsc}>
					{localizeResourceType(opt.rsc)}
				</option>;
			});

		const rscType = this.state.selectedOverrideResource;
		const info = resourceInfos.get(rscType);
		let inputSection = undefined;
		if (info !== undefined) {
			let showTimer, showAmount, showEnabled;
			let timerDefaultValue = "-1",
				timerOnChange = undefined;
			let amountDefaultValue = "0",
				amountOnChange = undefined;

			if (info.isCoolDown) {
				showTimer = true;
				showAmount = false;
				showEnabled = false;
				timerDefaultValue = this.state.overrideTimer;
				timerOnChange = this.setOverrideTimer;
			} else {
				// timer
				if (info.maxTimeout >= 0) {
					showTimer = true;
					timerDefaultValue = this.state.overrideTimer;
					timerOnChange = this.setOverrideTimer;
				} else {
					showTimer = false;
				}

				// amount
				// hide the amount display if the resource has only one stack
				// unless that stack is set by default
				if (info.maxValue > 1 || info.maxValue === info.defaultValue) {
					showAmount = true;
					amountDefaultValue = this.state.overrideStacks;
					amountOnChange = this.setOverrideStacks;
				} else {
					showAmount = false;
				}

				// enabled
				showEnabled = rscType === "LEY_LINES";
			}

			let timerDesc;
			if (info.isCoolDown) {
				timerDesc = localize({ en: "Time till full: ", zh: "距CD转好时间：" }) as string;
			} else if (rscType === "POLYGLOT") {
				timerDesc = localize({
					en: "Time till next stack: ",
					zh: "距下一层时间：",
				}) as string;
			} else {
				timerDesc = localize({ en: "Time till drop: ", zh: " 距状态消失时间：" }) as string;
			}

			const enabledDesc = localize({ en: "enabled", zh: "生效中" });

			inputSection = <div style={{ margin: "6px 0" }}>
				{/*timer*/}
				<div hidden={!showTimer}>
					<Input
						description={timerDesc}
						defaultValue={timerDefaultValue}
						onChange={timerOnChange}
					/>
				</div>

				{/*stacks*/}
				<div hidden={!showAmount}>
					<Input
						description={localize({ en: "Amount: ", zh: "数量：" })}
						defaultValue={amountDefaultValue}
						onChange={amountOnChange}
					/>
				</div>

				{/*enabled*/}
				<div hidden={!showEnabled}>
					<input
						style={{ position: "relative", top: 3, marginRight: 5 }}
						type="checkbox"
						checked={this.state.overrideEnabled}
						onChange={this.setOverrideEnabled}
					/>
					<span>{enabledDesc}</span>
				</div>
			</div>;
		}

		// @ts-expect-error: this.context is untyped, and we need this to access the ColorTheme context
		const bg = getThemeField(this.context, "bgMediumContrast");

		return <div>
			<form
				onSubmit={(evt) => {
					this.#addResourceOverride();
					this.setState({
						selectedOverrideResource: this.#getFirstAddable(
							this.state.initialResourceOverrides,
						),
					});
					evt.preventDefault();
				}}
				style={{
					marginTop: 16,
					outline: "1px solid " + bg,
					outlineOffset: 6,
				}}
			>
				<select
					value={this.state.selectedOverrideResource}
					onChange={(evt) => {
						if (evt.target) {
							this.setState({
								selectedOverrideResource: evt.target.value,
								overrideEnabled:
									evt.target.value === "LEY_LINES"
										? this.state.overrideEnabled
										: true,
							});
						}
					}}
				>
					{resourceOptions}
				</select>
				{inputSection}
				<input
					type="submit"
					value={localize({ en: "add override", zh: "应用此状态" }) as string}
				/>
			</form>
		</div>;
	}

	#resourceOverridesSection() {
		const resourceOverridesDisplayNodes = [];
		for (let i = 0; i < this.state.initialResourceOverrides.length; i++) {
			const override = this.state.initialResourceOverrides[i];
			resourceOverridesDisplayNodes.push(
				<ResourceOverrideDisplay
					job={this.state.job}
					key={i}
					override={override}
					deleteFn={this.deleteResourceOverride}
				/>,
			);
		}
		return <div style={{ marginTop: 10 }}>
			<Expandable
				title="overrideInitialResources"
				titleNode={
					<span>
						{localize({ en: "Override initial resources", zh: "指定初始资源" })}{" "}
						<Help
							topic="overrideInitialResources"
							content={localize({
								en: <div>
									<div className={"paragraph"} style={{ color: "orangered" }}>
										<b>
											Can create invalid game states. Go over
											Instructions/Troubleshoot first and use carefully at
											your own risk!
										</b>
									</div>
									<div className={"paragraph"}>
										Also, currently thunder dot buff created this way doesn't
										actually tick. It just shows the remaining buff timer.
									</div>
									<div className={"paragraph"}>
										I would recommend saving settings (stats, lines presets,
										timeline markers etc.) to files first, in case invalid game
										states really mess up the tool and a complete reset is
										required.
									</div>
								</div>,
								zh: <div>
									<div className={"paragraph"} style={{ color: "orangered" }}>
										<b>
											错误的初始资源可能会导致非法游戏状态。请在阅读工具顶部的使用说明/常见问题后慎重使用，并优先自行排查问题！
										</b>
									</div>
									<div className={"paragraph"}>
										另：当前靠初始资源覆盖添加的雷dot只显示剩余时间，不会结算伤害。
									</div>
									<div className={"paragraph"}>
										使用此功能时，请最好先下载保存各项数据（面板数值，技能轴，时间轴预设等），以防造成未知错误后排轴器重置导致的数据丢失。
									</div>
								</div>,
							})}
						/>
					</span>
				}
				content={
					<div>
						<button
							onClick={(evt) => {
								this.setState({ initialResourceOverrides: [], dirty: true });
								evt.preventDefault();
							}}
						>
							{localize({ en: "clear all overrides", zh: "清除所有指定初始资源" })}
						</button>
						{resourceOverridesDisplayNodes}
						{this.#addResourceOverrideNode()}
					</div>
				}
			/>
		</div>;
	}

	setConfigAndRestart(config: ConfigState) {
		if (
			isNaN(parseFloat(config.spellSpeed)) ||
			isNaN(parseFloat(config.skillSpeed)) ||
			isNaN(parseFloat(config.criticalHit)) ||
			isNaN(parseFloat(config.directHit)) ||
			isNaN(parseFloat(config.determination)) ||
			isNaN(parseFloat(config.animationLock)) ||
			isNaN(parseFloat(config.fps)) ||
			isNaN(parseFloat(config.gcdSkillCorrection)) ||
			isNaN(parseFloat(config.timeTillFirstManaTick)) ||
			isNaN(parseFloat(config.countdown)) ||
			isNaN(parseFloat(config.level))
		) {
			window.alert("Some config fields are not numbers!");
			return;
		}
		if (config.initialResourceOverrides === undefined) {
			config.initialResourceOverrides = [];
		}
		if (!(config.job in JOBS)) {
			window.alert("Invalid job: " + config.job);
			return;
		}
		controller.setConfigAndRestart({
			job: config.job,
			level: parseFloat(config.level),
			spellSpeed: parseFloat(config.spellSpeed),
			skillSpeed: parseFloat(config.skillSpeed),
			criticalHit: parseFloat(config.criticalHit),
			directHit: parseFloat(config.directHit),
			determination: parseFloat(config.determination),
			piety: parseFloat(config.piety),
			animationLock: parseFloat(config.animationLock),
			fps: parseFloat(config.fps),
			gcdSkillCorrection: parseFloat(config.gcdSkillCorrection),
			timeTillFirstManaTick: parseFloat(config.timeTillFirstManaTick),
			countdown: parseFloat(config.countdown),
			randomSeed: config.randomSeed.trim(),
			procMode: config.procMode,
			initialResourceOverrides: config.initialResourceOverrides, // info only
		});
		controller.updateAllDisplay();
	}

	componentWillUnmount() {
		updateConfigDisplay = (config) => {};
	}

	render() {
		// @ts-expect-error: this.context is untyped, and we need this to access the ColorTheme context
		const colors = getThemeColors(this.context);
		const fpsAndCorrectionColor =
			this.state.shellVersion >= ShellVersion.FpsTax ? colors.text : colors.warning;
		const isSps =
			JOBS[this.state.job].role === "CASTER" || JOBS[this.state.job].role === "HEALER";
		const speedStr = {
			en: isSps ? "spell" : "skill",
			zh: isSps ? "咏" : "技",
		};
		const gcdTaxDesc = <div>
			<style>{getTableStyle(colors.bgHighContrast)}</style>
			<div style={{ marginBottom: 10 }}>
				{localize({
					en: `Preview numbers based on your current ${speedStr.en} speed and FPS input:`,
					zh: `根据当前输入的${speedStr.zh}速和帧率，你将得到如下帧率税：`,
				})}
			</div>
			<table>
				<tbody>
					<tr>
						<th>{localize({ en: "GCD time", zh: "GCD时间" })}</th>
						<th>{localize({ en: "After FPS tax", zh: "帧率税后" })}</th>
					</tr>
					{[2.5, 3.0, 3.5, 4.0].map((recast, i) => <tr key={"gcdPreview" + i.toString()}>
						<td>
							{this.getDefaultGcd(recast).toFixed(2)} ({recast.toFixed(2)}{" "}
							{localize({ en: "base", zh: "原始" })})
						</td>
						<td>{this.getDefaultGcdTax(recast).toFixed(3)}</td>
					</tr>)}
				</tbody>
			</table>
		</div>;
		const etroLink = <a href="https://etro.gg" target="_blank" rel="noreferrer">
			etro
		</a>;
		const xivgearLink = <a href="https://xivgear.app" target="_blank" rel="noreferrer">
			xivgear
		</a>;
		const gearImportSection = <form onSubmit={this.importGear}>
			{localize({
				en: <span>
					Load stats from {etroLink}/{xivgearLink}:{" "}
				</span>,
				zh: <span>
					从{etroLink}或{xivgearLink}导入套装：
				</span>,
			})}
			<Help
				topic={"gearImport"}
				content={
					<>
						<p>
							{localize({
								en: <span>
									Enter and <ButtonIndicator text={"Load"} /> a link to a gearset
									from xivgear.app or etro.gg, edit the rest of config, then{" "}
									<ButtonIndicator text={"apply and reset"} />.
								</span>,
								zh: <span>
									输入xivgear.app或etro.gg的套装链接并
									<ButtonIndicator text={"加载"} />
									，调整其余角色属性，然后
									<ButtonIndicator text={"应用并重置时间轴"} />。
								</span>,
							})}
						</p>
						<p>
							{localize({
								en: "etro: Copy/paste the link to the set (example: https://etro.gg/gearset/e13d5960-4794-4dc4-b273-24ecfed6745e)",
								zh: "etro：复制粘贴套装链接（例：https://etro.gg/gearset/e13d5960-4794-4dc4-b273-24ecfed6745e）",
							})}
						</p>
						<p>
							{localize({
								en:
									'xivgear: At the top of the page, click "Export" -> "Selected Set" -> "Link to This Set" -> "Generate"' +
									" (example: https://xivgear.app/?page=sl%7C143f3245-c35b-4391-8b2b-db5cc1a8de9a)",
								zh: 'xivgear：从页面顶端点击 "Export" -> "Selected Set" -> "Link to This Set" -> "Generate"（例：https://xivgear.app/?page=sl%7C143f3245-c35b-4391-8b2b-db5cc1a8de9a）',
							})}
						</p>
					</>
				}
			/>
			<div style={{ position: "relative", marginTop: 5 }}>
				<Input
					style={{ display: "inline-block" }}
					width={25}
					description={""}
					onChange={(s) => {
						this.setState({ gearImportLink: s });
					}}
				/>
				<span> </span>
				<input
					style={{ display: "inline-block" }}
					type="submit"
					value={localize({ en: "Load", zh: "加载" }) as string}
				/>
				{
					<FaCheck
						style={{
							display: this.state.imported ? "inline" : "none",
							color: colors.success,
							position: "relative",
							top: 4,
							marginLeft: 8,
						}}
					/>
				}
			</div>
		</form>;
		const fieldColor = (field: string) => {
			if (this.state.importedFields.indexOf(field) > -1) {
				return colors.success;
			} else {
				return colors.text;
			}
		};
		const editJobSection = <div style={{ marginBottom: 10 }}>
			<span>{localize({ en: "job: ", zh: "职业：" })}</span>
			<select
				style={{ outline: "none", color: fieldColor("job") }}
				value={this.state.job}
				onChange={this.setJob}
			>
				{ALL_JOBS.filter((job) => JOBS[job].implementationLevel !== "UNIMPLEMENTED").map(
					(job) => {
						const impl = JOBS[job].implementationLevel as ImplementationKey;
						if (impl !== "LIVE") {
							return <option key={job} value={job}>
								{job +
									` (${localize(IMPLEMENTATION_LEVELS[impl].label ?? { en: "" })})`}
							</option>;
						} else {
							return <option key={job} value={job}>
								{job}
							</option>;
						}
					},
				)}
			</select>
		</div>;
		const editStatsSection = <div style={{ marginBottom: 16 }}>
			<div>
				<span>{localize({ en: "level: ", zh: "等级：" })}</span>
				<select
					style={{ outline: "none", color: fieldColor("level") }}
					value={this.state.level}
					onChange={this.setLevel}
				>
					<option key={LevelSync.lvl100} value={LevelSync.lvl100}>
						100
					</option>
					<option key={LevelSync.lvl90} value={LevelSync.lvl90}>
						90
					</option>
					<option key={LevelSync.lvl80} value={LevelSync.lvl80}>
						80
					</option>
					<option key={LevelSync.lvl70} value={LevelSync.lvl70}>
						70
					</option>
				</select>
			</div>
			<div>
				<Input
					style={{ display: "inline-block", color: fieldColor("spellSpeed") }}
					defaultValue={this.state.spellSpeed}
					description={localize({ en: "spell speed: ", zh: "咏速：" })}
					onChange={this.setSpellSpeed}
				/>
				<span>
					{" "}
					(GCD: {this.state.gcdPreview}{" "}
					<Help
						topic={"gcdPreview"}
						content={
							<>
								<p>
									{localize({
										en: "Preview of displayed GCD based on your spell speed.",
										zh: "当前咏速对应的游戏内显示的GCD.",
									})}
								</p>
								<p>
									{localize({
										en: `Measured average GCD should be ${this.state.taxedGcdPreview} due to FPS tax.`,
										zh: `由于帧率税的影响，测量得到的平均GCD为${this.state.taxedGcdPreview}。`,
									})}
								</p>
							</>
						}
					/>
					)
				</span>
			</div>
			<div>
				<Input
					style={{ display: "inline-block", color: fieldColor("skillSpeed") }}
					defaultValue={this.state.skillSpeed}
					description={localize({ en: "skill speed: ", zh: "技速：" })}
					onChange={this.setSkillSpeed}
				/>
				<span>
					{" "}
					(GCD: {this.state.sksGcdPreview}{" "}
					<Help
						topic={"sksGcdPreview"}
						content={
							<>
								<p>
									{localize({
										en: "Preview of displayed GCD based on your skill speed.",
										zh: "当前技速对应的游戏内显示的GCD.",
									})}
								</p>
								<p>
									{localize({
										en: `Measured average GCD should be ${this.state.taxedSksGcdPreview} due to FPS tax.`,
										zh: `由于帧率税的影响，测量得到的平均GCD为${this.state.taxedSksGcdPreview}。`,
									})}
								</p>
							</>
						}
					/>
					)
				</span>
			</div>
			<Input
				style={{ color: fieldColor("criticalHit") }}
				defaultValue={this.state.criticalHit}
				description={localize({ en: "crit: ", zh: "暴击：" })}
				onChange={this.setCriticalHit}
			/>
			<Input
				style={{ color: fieldColor("directHit") }}
				defaultValue={this.state.directHit}
				description={localize({ en: "direct hit: ", zh: "直击：" })}
				onChange={this.setDirectHit}
			/>
			<Input
				style={{ color: fieldColor("determination") }}
				defaultValue={this.state.determination}
				description={localize({ en: "determination: ", zh: "信念：" })}
				onChange={this.setDetermination}
			/>
			<Input
				style={{ color: fieldColor("piety") }}
				defaultValue={this.state.piety}
				description={localize({ en: "piety: ", zh: "信仰：" })}
				onChange={this.setPiety}
			/>
			<Input
				defaultValue={this.state.animationLock}
				description={localize({ en: "animation lock: ", zh: "能力技后摇：" })}
				onChange={this.setAnimationLock}
			/>
			<div>
				<Input
					componentColor={fpsAndCorrectionColor}
					style={{ display: "inline-block" }}
					defaultValue={this.state.fps}
					description={localize({ en: "FPS: ", zh: "帧率：" })}
					onChange={this.setFps}
				/>
				<span>
					{" "}
					(
					{localize({
						en: `${this.getDefaultGcd(2.5).toFixed(2)}s w/ tax`,
						zh: `${this.getDefaultGcd(2.5)}s+帧率税`,
					})}
					: {this.getDefaultGcdTax(2.5).toFixed(3)}{" "}
					<Help topic={"gcdTaxPreview"} content={gcdTaxDesc} />)
				</span>
			</div>
			<Input
				componentColor={fpsAndCorrectionColor}
				defaultValue={this.state.gcdSkillCorrection}
				description={
					<span>
						{localize({ en: "GCD correction", zh: "GCD时长修正" })}{" "}
						<Help
							topic={"cast-time-correction"}
							content={localize({
								en: "Leaving this at 0 will probably give you the most accurate simulation. But if you want to manually correct your GCD skill durations (including casts) for whatever reason, you can put a small number (can be negative)",
								zh: "正常情况下填0即能得到最精确的模拟结果。如果实在需要修正的话，这里输入的时长会被加到你的每个GCD技能（包括读条）耗时里（可以为负）",
							})}
						/>
						:{" "}
					</span>
				}
				onChange={this.setGcdSkillCorrection}
			/>
			<Input
				defaultValue={this.state.timeTillFirstManaTick}
				description={localize({ en: "time till first MP tick: ", zh: "距首次跳蓝时间：" })}
				onChange={this.setTimeTillFirstManaTick}
			/>
			<Input
				defaultValue={this.state.countdown}
				description={
					<span>
						{localize({ en: "countdown ", zh: "倒数时间 " })}
						<Help
							topic={"countdown"}
							content={localize({
								en: "can use a negative countdown to start from a specific time of fight",
								zh: "可以是负数，时间轴会从战斗中途某个时间开始显示",
							})}
						/>
						:{" "}
					</span>
				}
				onChange={this.setCountdown}
			/>
			<Input
				defaultValue={this.state.randomSeed}
				description={
					<span>
						{localize({ en: "random seed ", zh: "随机种子 " })}
						<Help
							topic={"randomSeed"}
							content={localize({
								en: "can be anything, or leave empty to get 4 random digits.",
								zh: "可以是任意字符串，或者留空，会获得4个随机数字",
							})}
						/>
						:{" "}
					</span>
				}
				onChange={this.setRandomSeed}
			/>
			<div>
				<span>
					{localize({ en: "proc mode ", zh: "随机BUFF获取 " })}
					<Help
						topic={"procMode"}
						content={localize({
							en: "Default RNG: 40% Firestarter",
							zh: "RNG会像游戏内一样，相应技能40%概率获得火苗，Always则每次都会触发火苗，Never则从不触发。",
						})}
					/>
					:{" "}
				</span>
				<select
					style={{ outline: "none" }}
					value={this.state.procMode}
					onChange={this.setProcMode}
				>
					<option key={ProcMode.RNG} value={ProcMode.RNG}>
						RNG
					</option>
					<option key={ProcMode.Never} value={ProcMode.Never}>
						Never
					</option>
					<option key={ProcMode.Always} value={ProcMode.Always}>
						Always
					</option>
				</select>
			</div>
			{this.#resourceOverridesSection()}
			<button
				onClick={this.handleSubmit}
				style={{ width: "100%", fontWeight: this.state.dirty ? "bold" : "normal" }}
			>
				{localize({ en: "apply and reset", zh: "应用并重置时间轴" })}
				{this.state.dirty ? "*" : ""}
			</button>
		</div>;
		return <div style={{ marginBottom: 20 }}>
			{gearImportSection}
			<br />
			{editJobSection}
			<ConfigSummary job={controller.getActiveJob()} dirty={this.state.dirty} />
			{editStatsSection}
			<p>
				{localize({
					en: "You can also import/export fights from/to local files at the bottom of the page.",
					zh: "页面底部有导入和导出战斗文件相关选项。",
				})}
			</p>
		</div>;
	}
}
