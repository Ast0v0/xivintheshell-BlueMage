import React, { useEffect, useRef, useState, useContext } from "react";
import {
	AutoTickMarkElem,
	CursorElem,
	PotencyMarkElem,
	ElemType,
	LucidMarkElem,
	MarkerElem,
	MarkerType,
	MAX_TIMELINE_SLOTS,
	MeditateTickMarkElem,
	MPTickMarkElem,
	SharedTimelineElem,
	SkillElem,
	SlotTimelineElem,
	TimelineElem,
	UntargetableMarkerTrack,
	ViewOnlyCursorElem,
	WarningMarkElem,
} from "../Controller/Timeline";
import {
	DEFAULT_TIMELINE_OPTIONS,
	StaticFn,
	TimelineDimensions,
	TimelineDrawOptions,
} from "./Common";
import { BuffType } from "../Game/Common";
import { getSkillIconImage } from "./Skills";
import { buffIconImages } from "./Buffs";
import { controller } from "../Controller/Controller";
import {
	localize,
	localizeResourceType,
	localizeBuffType,
	localizeSkillName,
	localizeSkillUnavailableReason,
} from "./Localization";
import { setEditingMarkerValues } from "./TimelineMarkers";
import { getThemeColors, ThemeColors, ColorThemeContext } from "./ColorTheme";
import { scrollEditorToFirstSelected } from "./TimelineEditor";
import { bossIsUntargetable } from "../Controller/DamageStatistics";
import { updateTimelineView } from "./Timeline";
import { ShellJob } from "../Game/Data/Jobs";
import { LIMIT_BREAK_ACTIONS } from "../Game/Data/Shared/LimitBreak";

export type TimelineRenderingProps = {
	timelineWidth: number;
	timelineHeight: number;
	countdown: number;
	scale: number;
	tincturePotencyMultiplier: number;
	untargetableMask: boolean;
	allMarkers: MarkerElem[];
	untargetableMarkers: MarkerElem[];
	buffMarkers: MarkerElem[];
	sharedElements: SharedTimelineElem[];
	slots: {
		job: ShellJob;
		elements: SlotTimelineElem[];
	}[];
	activeSlotIndex: number;
	showSelection: boolean;
	selectionStartDisplayTime: number;
	selectionEndDisplayTime: number;
	drawOptions: TimelineDrawOptions;
};

const c_maxTimelineHeight = 400;

let g_ctx: CanvasRenderingContext2D;

let g_visibleLeft = 0;
let g_visibleWidth = 0;
let g_isClickUpdate = false;
let g_clickEvent: any = undefined; // valid when isClickUpdate is true
let g_keyboardEvent: any = undefined;
let g_mouseX = 0;
let g_mouseY = 0;
let g_mouseHovered = false;

let g_colors: ThemeColors;

// updated on mouse enter/leave, updated and reset on every draw
let g_activeHoverTip: string[] | undefined = undefined;
let g_activeHoverTipImages: any[] | undefined = undefined;
let g_activeOnClick: (() => void) | undefined = undefined;

let g_renderingProps: TimelineRenderingProps = {
	timelineWidth: 0,
	timelineHeight: 0,
	countdown: 0,
	scale: 1,
	tincturePotencyMultiplier: 1,
	allMarkers: [],
	untargetableMarkers: [],
	buffMarkers: [],
	untargetableMask: true,
	sharedElements: [],
	slots: [],
	activeSlotIndex: 0,
	showSelection: false,
	selectionStartDisplayTime: 0,
	selectionEndDisplayTime: 0,
	drawOptions: DEFAULT_TIMELINE_OPTIONS,
};

let cachedPointerMouse = false;
let readback_pointerMouse = false;

// qol: event capture mask? So can provide a layer that overwrites keyboard event only and not affect the rest
// all coordinates in canvas space
function testInteraction(
	rect: Rect,
	hoverTip?: string[],
	onClick?: () => void,
	pointerMouse?: boolean,
	hoverImages?: any[],
) {
	if (
		g_mouseX >= rect.x &&
		g_mouseX < rect.x + rect.w &&
		g_mouseY >= rect.y &&
		g_mouseY < rect.y + rect.h
	) {
		g_activeHoverTip = hoverTip;
		g_activeHoverTipImages = hoverImages;
		g_activeOnClick = onClick;
		readback_pointerMouse = pointerMouse === true;
	}
}

const onClickTimelineBackground = () => {
	// clicked on background:
	controller.record.unselectAll();
	controller.displayCurrentState();
};

function drawTip(lines: string[], canvasWidth: number, canvasHeight: number, images?: any[]) {
	if (!lines.length) return;

	const lineHeight = 14;
	const imageDimensions = 24;
	const horizontalPadding = 8;
	const verticalPadding = 4;
	g_ctx.font = "12px monospace";

	let maxLineWidth = -1;
	lines.forEach((l) => {
		maxLineWidth = Math.max(maxLineWidth, g_ctx.measureText(l).width);
	});
	let [boxWidth, boxHeight] = [
		maxLineWidth + 2 * horizontalPadding,
		lineHeight * lines.length + 2 * verticalPadding,
	];

	if (images && images.length > 0) {
		boxWidth = Math.max(
			boxWidth,
			horizontalPadding + images.length * (imageDimensions + horizontalPadding),
		);
		boxHeight += imageDimensions + verticalPadding;
	}

	let x = g_mouseX;
	let y = g_mouseY;

	// compute optimal box position
	const boxToMousePadding = 4;
	const estimatedMouseHeight = 11;
	if (y >= boxHeight + boxToMousePadding) {
		// put on top
		y = y - boxHeight - boxToMousePadding;
	} else {
		y = y + estimatedMouseHeight + boxToMousePadding;
	}
	if (x - boxWidth / 2 >= 0 && x + boxWidth / 2 < canvasWidth) {
		x = x - boxWidth / 2;
	} else if (x - boxWidth / 2 < 0) {
		x = 0;
	} else {
		x = canvasWidth - boxWidth;
	}

	// start drawing
	g_ctx.strokeStyle = g_colors.bgHighContrast;
	g_ctx.lineWidth = 1;
	g_ctx.fillStyle = g_colors.tipBackground;
	g_ctx.fillRect(x, y, boxWidth, boxHeight);
	g_ctx.strokeRect(x, y, boxWidth, boxHeight);

	g_ctx.fillStyle = g_colors.emphasis;
	g_ctx.textBaseline = "top";
	g_ctx.textAlign = "left";
	for (let i = 0; i < lines.length; i++) {
		g_ctx.fillText(lines[i], x + horizontalPadding, y + i * lineHeight + 2 + verticalPadding);
	}
	const initialImageX = x + horizontalPadding;
	const initialImageY = y + lines.length * lineHeight + 2 + verticalPadding;
	if (images) {
		for (let i = 0; i < images.length; i++) {
			if (images[i]) {
				g_ctx.drawImage(
					images[i],
					initialImageX + i * imageDimensions,
					initialImageY,
					imageDimensions * 0.75,
					imageDimensions,
				);
			}
		}
	}
}

function drawMarkers(
	countdown: number,
	scale: number,
	markerTracksTopY: number,
	markerTracksBottomY: number, // bottom Y of track 0
	timelineOrigin: number,
	trackBins: Map<number, MarkerElem[]>,
) {
	// markers
	g_ctx.lineCap = "round";
	g_ctx.lineWidth = 4;
	g_ctx.font = "11px monospace";
	g_ctx.textAlign = "left";
	trackBins.forEach((elems, track) => {
		let top = markerTracksBottomY - (track + 1) * TimelineDimensions.trackHeight;
		if (track === UntargetableMarkerTrack) {
			top = markerTracksTopY;
		}
		for (let i = 0; i < elems.length; i++) {
			const m = elems[i];

			let localizedDescription = m.description;
			if (m.markerType === MarkerType.Untargetable)
				localizedDescription = localize({ en: "Untargetable", zh: "不可选中" }) as string;
			else if (m.markerType === MarkerType.Buff)
				localizedDescription = localizeBuffType(m.description as BuffType);

			const left =
				timelineOrigin + StaticFn.positionFromTimeAndScale(m.time + countdown, scale);
			const onClick = () => {
				const success = controller.timeline.deleteMarker(m);
				console.assert(success);
				controller.updateStats();
				setEditingMarkerValues(m);
			};
			if (m.duration > 0) {
				const markerWidth = StaticFn.positionFromTimeAndScale(m.duration, scale);
				if (m.markerType === MarkerType.Buff) {
					g_ctx.fillStyle = m.color + g_colors.timeline.markerAlpha;
					g_ctx.fillRect(left, top, markerWidth, TimelineDimensions.trackHeight);
					const img = buffIconImages.get(m.description as BuffType);
					if (img)
						g_ctx.drawImage(
							img,
							left,
							top,
							TimelineDimensions.trackHeight * 0.75,
							TimelineDimensions.trackHeight,
						);
					g_ctx.fillStyle = g_colors.emphasis;
					g_ctx.fillText(
						localizedDescription,
						left + TimelineDimensions.trackHeight * 1.5,
						top + 10,
					);
				} else if (m.showText) {
					g_ctx.fillStyle = m.color + g_colors.timeline.markerAlpha;
					g_ctx.fillRect(left, top, markerWidth, TimelineDimensions.trackHeight);
					g_ctx.fillStyle = g_colors.emphasis;
					g_ctx.fillText(
						localizedDescription,
						left + TimelineDimensions.trackHeight / 2,
						top + 10,
					);
				} else {
					g_ctx.strokeStyle = m.color;
					g_ctx.beginPath();
					g_ctx.moveTo(left, top + TimelineDimensions.trackHeight / 2);
					g_ctx.lineTo(left + markerWidth, top + TimelineDimensions.trackHeight / 2);
					g_ctx.stroke();
				}
				const timeStr = m.time + " - " + parseFloat((m.time + m.duration).toFixed(3));
				testInteraction(
					{
						x: left,
						y: top,
						w: Math.max(markerWidth, TimelineDimensions.trackHeight),
						h: TimelineDimensions.trackHeight,
					},
					["[" + timeStr + "] " + localizedDescription],
					onClick,
				);
			} else {
				g_ctx.fillStyle = m.color;
				g_ctx.beginPath();
				g_ctx.ellipse(
					left,
					top + TimelineDimensions.trackHeight / 2,
					4,
					4,
					0,
					0,
					2 * Math.PI,
				);
				g_ctx.fill();
				if (m.showText) {
					g_ctx.fillStyle = g_colors.emphasis;
					g_ctx.beginPath();
					g_ctx.fillText(
						localizedDescription,
						left + TimelineDimensions.trackHeight / 2,
						top + 10,
					);
				}
				testInteraction(
					{
						x: left - TimelineDimensions.trackHeight / 2,
						y: top,
						w: TimelineDimensions.trackHeight,
						h: TimelineDimensions.trackHeight,
					},
					["[" + m.time + "] " + localizedDescription],
					onClick,
				);
			}
		}
	});
}

function drawMPTickMarks(
	countdown: number,
	scale: number,
	originX: number,
	originY: number,
	elems: MPTickMarkElem[],
) {
	g_ctx.lineWidth = 1;
	g_ctx.strokeStyle = g_colors.timeline.mpTickMark;
	g_ctx.beginPath();
	elems.forEach((tick) => {
		const x = originX + StaticFn.positionFromTimeAndScale(tick.displayTime, scale);
		g_ctx.moveTo(x, originY);
		g_ctx.lineTo(x, originY + TimelineDimensions.renderSlotHeight());

		testInteraction({ x: x - 2, y: originY, w: 4, h: TimelineDimensions.renderSlotHeight() }, [
			"[" + tick.displayTime.toFixed(3) + "] " + tick.sourceDesc,
		]);
	});
	g_ctx.stroke();
}

function drawMeditateTickMarks(
	countdown: number,
	scale: number,
	originX: number,
	originY: number,
	elems: MeditateTickMarkElem[],
) {
	g_ctx.lineWidth = 1;
	g_ctx.strokeStyle = g_colors.sam.meditation;
	g_ctx.beginPath();
	elems.forEach((tick) => {
		const x = originX + StaticFn.positionFromTimeAndScale(tick.displayTime, scale);
		g_ctx.moveTo(x, originY);
		g_ctx.lineTo(x, originY + TimelineDimensions.renderSlotHeight());

		testInteraction({ x: x - 2, y: originY, w: 4, h: TimelineDimensions.renderSlotHeight() }, [
			"[" + tick.displayTime.toFixed(3) + "] " + tick.sourceDesc,
		]);
	});
	g_ctx.stroke();
}

function drawAutoTickMarks(
	countdown: number,
	scale: number,
	originX: number,
	originY: number,
	elems: AutoTickMarkElem[],
) {
	g_ctx.lineWidth = 1;
	g_ctx.strokeStyle = g_colors.pld.ironWillColor;
	g_ctx.beginPath();
	elems.forEach((tick) => {
		const x = originX + StaticFn.positionFromTimeAndScale(tick.displayTime, scale);
		g_ctx.moveTo(x, originY);
		g_ctx.lineTo(x, originY + TimelineDimensions.renderSlotHeight());

		testInteraction({ x: x - 2, y: originY, w: 4, h: TimelineDimensions.renderSlotHeight() }, [
			"[" + tick.displayTime.toFixed(3) + "] " + tick.sourceDesc,
		]);
	});
	g_ctx.stroke();
}

function drawWarningMarks(
	countdown: number,
	scale: number,
	timelineOriginX: number,
	timelineOriginY: number,
	elems: WarningMarkElem[],
) {
	g_ctx.font = "bold 10px monospace";
	elems.forEach((mark) => {
		const x = timelineOriginX + StaticFn.positionFromTimeAndScale(mark.displayTime, scale);
		const sideLength = 12;
		const bottomY = timelineOriginY + sideLength;
		g_ctx.beginPath();
		g_ctx.textAlign = "center";
		g_ctx.moveTo(x, bottomY - sideLength);
		g_ctx.lineTo(x - sideLength / 2, bottomY);
		g_ctx.lineTo(x + sideLength / 2, bottomY);
		g_ctx.fillStyle = g_colors.timeline.warningMark;
		g_ctx.fill();
		g_ctx.fillStyle = "white";
		g_ctx.fillText("!", x, bottomY - 1);

		let message: string = "[" + mark.displayTime.toFixed(3) + "] ";
		switch (mark.warningType.kind) {
			case "combobreak":
				message += localize({
					en: "broken combo!",
					zh: "连击被断！",
				}).toString();
				break;
			case "overcap":
				message +=
					localizeResourceType(mark.warningType.rsc).toString() +
					localize({
						en: " overcap!",
						zh: "溢出！",
					}).toString();
				break;
			case "overwrite":
				message +=
					localizeResourceType(mark.warningType.rsc).toString() +
					localize({
						en: " overwrite!",
						zh: "被覆盖！",
					}).toString();
				break;
			case "timeout":
				message +=
					localizeResourceType(mark.warningType.rsc).toString() +
					localize({
						en: " expired!",
						zh: "已过期！",
					});
				break;
			default:
				message += localize({
					en: mark.warningType.en,
					zh: mark.warningType.zh,
				});
				break;
		}
		testInteraction(
			{ x: x - sideLength / 2, y: bottomY - sideLength, w: sideLength, h: sideLength },
			[message],
		);
	});
}

function drawPotencyMarks(
	countdown: number,
	scale: number,
	timelineOriginX: number,
	timelineOriginY: number,
	elems: PotencyMarkElem[],
) {
	elems.forEach((mark) => {
		// Only consider untargetable for damage marks
		const untargetable =
			mark.type === ElemType.DamageMark && bossIsUntargetable(mark.displayTime);
		const x = timelineOriginX + StaticFn.positionFromTimeAndScale(mark.displayTime, scale);

		// hover text
		let time = "[" + mark.displayTime.toFixed(3) + "] ";
		const untargetableStr = localize({ en: "Untargetable", zh: "不可选中" }) as string;

		// Determine fill color and hover text title based on mark type
		switch (mark.type) {
			case ElemType.AggroMark:
				g_ctx.fillStyle = g_colors.timeline.aggroMark;
				time += localize({ en: "aggro" });
				break;
			case ElemType.HealingMark:
				g_ctx.fillStyle = g_colors.timeline.healingMark;
				time += localize({ en: "healing potency" });
				break;
			// If it's a damage mark, adjust color based on whether the boss is untargetable
			default:
				g_ctx.fillStyle = untargetable
					? g_colors.timeline.untargetableDamageMark
					: g_colors.timeline.damageMark;
				time += localize({ en: "damage potency" });
		}

		// Create the appropriate shape
		g_ctx.beginPath();
		if (mark.type === ElemType.AggroMark || mark.type === ElemType.DamageMark) {
			// Aggro and Damage are a triangle pointing down
			g_ctx.moveTo(x - 3, timelineOriginY);
			g_ctx.lineTo(x + 3, timelineOriginY);
			g_ctx.lineTo(x, timelineOriginY + 6);
		} else {
			// Healing is a triangle pointing up, and shifted down so it's visible at the same timestamp as a damage/aggro mark
			g_ctx.moveTo(x - 3, timelineOriginY + 12);
			g_ctx.lineTo(x + 3, timelineOriginY + 12);
			g_ctx.lineTo(x, timelineOriginY + 6);
		}
		g_ctx.fill();

		// pot?
		const pot = mark.buffs.filter((b) => b === "TINCTURE").length > 0;

		const info: string[] = [];
		const buffImages: Array<HTMLImageElement | undefined> = [];

		mark.potencyInfos.forEach((potencyInfo) => {
			const sourceStr = potencyInfo.sourceDesc.replace(
				"{skill}",
				localizeSkillName(potencyInfo.sourceSkill),
			);

			if (untargetable) {
				info.push((0).toFixed(3) + " (" + sourceStr + ")");
			} else if (potencyInfo.sourceSkill in LIMIT_BREAK_ACTIONS) {
				const lbStr = localize({ en: "LB" }) as string;
				info.push(lbStr + " (" + sourceStr + ")");
			} else {
				const potencyAmount = potencyInfo.potency.getAmount({
					tincturePotencyMultiplier: g_renderingProps.tincturePotencyMultiplier,
					includePartyBuffs: true,
					includeSplash: false,
				});

				// Push additional info for hits that splash
				if (potencyInfo.potency.targetCount > 1) {
					const splashPotencyAmount =
						potencyAmount * (1 - (potencyInfo.potency.falloff ?? 1));
					const splashTargets = potencyInfo.potency.targetCount - 1;
					const splashPotencyString =
						splashPotencyAmount.toFixed(2) +
						(splashTargets > 1 ? ` x ${splashTargets}` : "");

					const additionalTargetString =
						splashTargets > 1
							? localize({
									en: `${sourceStr}, ${splashTargets} additional targets`,
									zh: `${sourceStr}, ${splashTargets} 额外目标`,
								})
							: localize({
									en: `${sourceStr}, 1 additional target`,
									zh: `${sourceStr}, 1 额外目标`,
								});
					info.push(
						potencyAmount.toFixed(2) +
							" (" +
							localize({
								en: `${sourceStr}, primary target`,
								zh: `${sourceStr}, 主要目标`,
							}) +
							")",
					);
					info.push(splashPotencyString + ` (${additionalTargetString})`);
				} else {
					info.push(potencyAmount.toFixed(2) + " (" + sourceStr + ")");
				}

				if (pot && !buffImages.includes(buffIconImages.get(BuffType.Tincture))) {
					buffImages.push(buffIconImages.get(BuffType.Tincture));
				}

				potencyInfo.potency.getPartyBuffs().forEach((desc) => {
					const buffImage = buffIconImages.get(desc);
					if (!buffImages.includes(buffImage)) {
						buffImages.push();
					}
				});
			}
		});

		const interactionArea =
			mark.type === ElemType.HealingMark
				? { x: x - 3, y: timelineOriginY + 6, w: 6, h: 6 }
				: { x: x - 3, y: timelineOriginY, w: 6, h: 6 };
		testInteraction(
			interactionArea,
			untargetable ? [time, ...info, untargetableStr] : [time, ...info],
			undefined,
			undefined,
			buffImages,
		);
	});
}

function drawLucidMarks(
	countdown: number,
	scale: number,
	timelineOriginX: number,
	timelineOriginY: number,
	elems: LucidMarkElem[],
) {
	g_ctx.fillStyle = g_colors.timeline.lucidTickMark;
	elems.forEach((mark) => {
		const x = timelineOriginX + StaticFn.positionFromTimeAndScale(mark.displayTime, scale);
		g_ctx.beginPath();
		g_ctx.moveTo(x - 3, timelineOriginY);
		g_ctx.lineTo(x + 3, timelineOriginY);
		g_ctx.lineTo(x, timelineOriginY + 6);
		g_ctx.fill();

		// hover text
		const hoverText =
			"[" +
			mark.displayTime.toFixed(3) +
			"] " +
			mark.sourceDesc.replace("{skill}", localizeSkillName("LUCID_DREAMING"));
		testInteraction({ x: x - 3, y: timelineOriginY, w: 6, h: 6 }, [hoverText]);
	});
}

type Rect = { x: number; y: number; w: number; h: number };
function drawSkills(
	countdown: number,
	scale: number,
	timelineOriginX: number,
	timelineOriginY: number,
	elems: SkillElem[],
	interactive: boolean,
) {
	const targetCounts: Array<{ count: number; x: number; y: number }> = [];
	const greyLockBars: Rect[] = [];
	const purpleLockBars: Rect[] = [];
	const gcdBars: Rect[] = [];
	const snapshots: number[] = [];

	// TODO move this into a proper configuration file
	const coverInfo: Map<BuffType, { color: string; showImage: boolean }> = new Map([
		[BuffType.Tincture, { color: g_colors.timeline.potCover, showImage: true }],
		[BuffType.LeyLines, { color: g_colors.timeline.llCover, showImage: true }],
		[BuffType.SearingLight, { color: g_colors.smn.searing, showImage: true }],
		[BuffType.Hyperphantasia, { color: g_colors.timeline.llCover, showImage: false }],
		[BuffType.StarryMuse, { color: g_colors.timeline.buffCover, showImage: true }],
		[BuffType.Embolden, { color: g_colors.rdm.emboldenBuff, showImage: true }],
		[BuffType.Manafication, { color: g_colors.rdm.manaficBuff, showImage: true }],
		[BuffType.Acceleration, { color: g_colors.rdm.accelBuff, showImage: true }],
		[BuffType.TechnicalFinish, { color: g_colors.dnc.esprit, showImage: true }],
		[BuffType.Devilment, { color: g_colors.dnc.feathers, showImage: true }],
		// TODO swap colors eventually
		[BuffType.Fuka, { color: g_colors.timeline.llCover, showImage: true }],
		[BuffType.Fugetsu, { color: g_colors.sam.fugetsu, showImage: true }],
		[BuffType.NoMercy, { color: g_colors.sam.fugetsu, showImage: true }],
		[
			BuffType.EnhancedPiercingTalon,
			{ color: g_colors.drg.enhancedPiercingTalon, showImage: true },
		],
		[BuffType.PowerSurge, { color: g_colors.drg.powerSurge, showImage: true }],
		[BuffType.LifeSurge, { color: g_colors.drg.lifeSurge, showImage: true }],
		[BuffType.LanceCharge, { color: g_colors.drg.lanceCharge, showImage: true }],
		[BuffType.LifeOfTheDragon, { color: g_colors.drg.lifeOfTheDragon, showImage: true }],
		[BuffType.BattleLitany, { color: g_colors.drg.battleLitany, showImage: true }],
		[BuffType.DivineMight, { color: g_colors.pld.divineMight, showImage: true }],
		[BuffType.Requiescat, { color: g_colors.pld.requiescat, showImage: true }],
		[BuffType.FightOrFlight, { color: g_colors.pld.fightOrFlight, showImage: true }],
		[BuffType.EnhancedEnpi, { color: g_colors.rdm.accelBuff, showImage: true }],
		[BuffType.ArcaneCircle, { color: g_colors.rpr.arcaneCircle, showImage: true }],
		[BuffType.DeathsDesign, { color: g_colors.rpr.deathsDesign, showImage: true }],
		[BuffType.WanderersMinuet, { color: g_colors.brd.wanderersCoda, showImage: true }],
		[BuffType.MagesBallad, { color: g_colors.brd.magesCoda, showImage: true }],
		[BuffType.ArmysPaeon, { color: g_colors.brd.armysCoda, showImage: true }],
		[BuffType.RagingStrikes, { color: g_colors.brd.ragingStrikes, showImage: true }],
		[BuffType.Barrage, { color: g_colors.brd.barrage, showImage: true }],
		[BuffType.BattleVoice, { color: g_colors.brd.battleVoice, showImage: true }],
		[BuffType.RadiantFinale1, { color: g_colors.brd.radiantFinale, showImage: true }],
		[BuffType.RadiantFinale2, { color: g_colors.brd.radiantFinale, showImage: true }],
		[BuffType.RadiantFinale3, { color: g_colors.brd.radiantFinale, showImage: true }],
		[BuffType.Zoe, { color: g_colors.sge.zoe, showImage: true }],
		[BuffType.Autophysis, { color: g_colors.sge.autophysis, showImage: true }],
		[BuffType.Krasis, { color: g_colors.sge.krasis, showImage: true }],
		[BuffType.Soteria, { color: g_colors.sge.soteria, showImage: true }],
		[BuffType.Philosophia, { color: g_colors.sge.philosophia, showImage: true }],
		[BuffType.WaxingNocturne, { color: g_colors.blu.moonflute, showImage: true }],
		[BuffType.Bristle, { color: g_colors.blu.bristle, showImage: true }],
		[BuffType.Whistle, { color: g_colors.blu.whistle, showImage: true }],
		[BuffType.TingleA, { color: g_colors.blu.tinglea, showImage: true }],
		[BuffType.TingleB, { color: g_colors.blu.tingleb, showImage: true }],
		[BuffType.Dokumori, { color: g_colors.nin.dokumori, showImage: true }],
		[BuffType.TrickAttack, { color: g_colors.nin.trick, showImage: true }],
		[BuffType.KunaisBane, { color: g_colors.nin.trick, showImage: true }],
		[BuffType.Bunshin, { color: g_colors.nin.bunshin, showImage: true }],
		[BuffType.RiddleOfFire, { color: g_colors.mnk.riddleOfFire, showImage: true }],
		[BuffType.Brotherhood, { color: g_colors.mnk.brotherhood, showImage: true }],
		[BuffType.Divination, { color: g_colors.ast.div, showImage: true }],
		[BuffType.NeutralSect, { color: g_colors.ast.neutral, showImage: true }],
		[BuffType.Synastry, { color: g_colors.ast.synastry, showImage: true }],
		[BuffType.TheArrow, { color: g_colors.ast.arrow, showImage: true }],
		[BuffType.Confession, { color: g_colors.whm.confession, showImage: true }],
		[BuffType.Asylum, { color: g_colors.whm.asylum, showImage: true }],
		[BuffType.Temperance, { color: g_colors.whm.temperance, showImage: true }],
		[BuffType.HuntersInstinct, { color: g_colors.vpr.huntersInstinct, showImage: true }],
		[BuffType.Swiftscaled, { color: g_colors.vpr.swiftscaled, showImage: true }],
		[BuffType.ChainStratagem, { color: g_colors.sch.chain, showImage: true }],
		[BuffType.FeyIllumination, { color: g_colors.sch.feyIllumination, showImage: true }],
		[BuffType.Dissipation, { color: g_colors.sch.dissipation, showImage: true }],
		[BuffType.Protraction, { color: g_colors.sch.protraction, showImage: true }],
		[BuffType.Recitation, { color: g_colors.sch.recitation, showImage: true }],
	]);

	const covers: Map<BuffType, Rect[]> = new Map();
	coverInfo.forEach((_, buff) => covers.set(buff, []));
	const buffCovers: Rect[] = [];
	const invalidSections: Rect[] = [];

	const skillIcons: { elem: SkillElem; x: number; y: number }[] = []; // tmp
	const skillsTopY = timelineOriginY + TimelineDimensions.skillButtonHeight / 2;
	elems.forEach((e) => {
		const skill = e as SkillElem;
		const x = timelineOriginX + StaticFn.positionFromTimeAndScale(skill.displayTime, scale);
		const y = skill.isGCD ? skillsTopY + TimelineDimensions.skillButtonHeight / 2 : skillsTopY;
		// if there were multiple targets, draw the number of targets above the ability icon
		const targetCount = skill.node.targetCount;
		if (targetCount > 1) {
			targetCounts.push({
				count: targetCount,
				x: x + TimelineDimensions.skillButtonHeight / 2,
				y: y - 5,
			});
		}
		// offset the bar under skill button icon so it's completely invisible before the button
		const barsOffset = 2;
		// purple/grey bar
		const lockbarWidth = StaticFn.positionFromTimeAndScale(skill.lockDuration, scale);
		if (skill.isSpellCast) {
			purpleLockBars.push({
				x: x + barsOffset,
				y: y,
				w: lockbarWidth - barsOffset,
				h: TimelineDimensions.skillButtonHeight / 2,
			});
			snapshots.push(
				x + StaticFn.positionFromTimeAndScale(skill.relativeSnapshotTime, scale),
			);
		} else {
			greyLockBars.push({
				x: x + barsOffset,
				y: y,
				w: lockbarWidth - barsOffset,
				h: TimelineDimensions.skillButtonHeight,
			});
		}
		// green gcd recast bar
		if (skill.isGCD) {
			const recastWidth = StaticFn.positionFromTimeAndScale(skill.recastDuration, scale);
			gcdBars.push({
				x: x + barsOffset,
				y: y + TimelineDimensions.skillButtonHeight / 2,
				w: recastWidth - barsOffset,
				h: TimelineDimensions.skillButtonHeight / 2,
			});
		}
		if (skill.skillName in LIMIT_BREAK_ACTIONS) {
			const recastWidth = StaticFn.positionFromTimeAndScale(skill.recastDuration, scale);
			greyLockBars.push({
				x: x + barsOffset,
				y: y + TimelineDimensions.skillButtonHeight / 2,
				w: recastWidth - barsOffset,
				h: TimelineDimensions.skillButtonHeight / 2,
			});
		}
		// invalid skill shading
		if (skill.node.tmp_invalid_reasons.length > 0) {
			invalidSections.push({
				x,
				y: timelineOriginY + TimelineDimensions.slotPaddingTop,
				w: StaticFn.positionFromTimeAndScale(
					skill.isGCD
						? Math.max(skill.recastDuration, skill.lockDuration)
						: skill.lockDuration,
					scale,
				),
				h:
					TimelineDimensions.renderSlotHeight() -
					TimelineDimensions.slotPaddingBottom -
					TimelineDimensions.slotPaddingTop,
			});
		}

		// node covers (LL, pot, party buff)
		// TODO automate declarations for these modifiers
		let nodeCoverCount = 0;
		covers.forEach((coverArray, buffType) => {
			if (skill.node.hasBuff(buffType)) {
				nodeCoverCount += buildCover(nodeCoverCount, coverArray);
			}
		});
		if (skill.node.hasPartyBuff()) buildCover(nodeCoverCount, buffCovers);

		function buildCover(existingCovers: number, collection: Rect[]) {
			if (g_renderingProps.drawOptions.drawBuffIndicators) {
				collection.push({ x: x, y: y + 28 + existingCovers * 4, w: 28, h: 4 });
			}
			return 1;
		}

		// skill icon
		const img = getSkillIconImage(skill.skillName);
		if (img) skillIcons.push({ elem: e, x: x, y: y });
	});

	// target counts
	g_ctx.font = "13px monospace";
	g_ctx.fillStyle = g_colors.text;
	g_ctx.textAlign = "center";
	targetCounts.forEach((c) => {
		g_ctx.fillText("x" + c.count.toString(), c.x, c.y);
	});

	// purple
	g_ctx.fillStyle = g_colors.timeline.castBar;
	g_ctx.beginPath();
	purpleLockBars.forEach((r) => {
		g_ctx.rect(r.x, r.y, r.w, r.h);
		if (interactive) testInteraction(r, undefined, onClickTimelineBackground);
	});
	g_ctx.fill();

	// snapshot bar
	g_ctx.lineWidth = 1;
	g_ctx.strokeStyle = "rgba(151, 85, 239, 0.4)";
	g_ctx.beginPath();
	snapshots.forEach((x) => {
		g_ctx.moveTo(x, skillsTopY + 14);
		g_ctx.lineTo(x, skillsTopY + 28);
	});
	g_ctx.stroke();

	// green
	g_ctx.fillStyle = g_colors.timeline.gcdBar;
	g_ctx.beginPath();
	gcdBars.forEach((r) => {
		g_ctx.rect(r.x, r.y, r.w, r.h);
		if (interactive) testInteraction(r, undefined, onClickTimelineBackground);
	});
	g_ctx.fill();

	// grey
	g_ctx.fillStyle = g_colors.timeline.lockBar;
	g_ctx.beginPath();
	greyLockBars.forEach((r) => {
		g_ctx.rect(r.x, r.y, r.w, r.h);
		if (interactive) testInteraction(r, undefined, onClickTimelineBackground);
	});
	g_ctx.fill();

	covers.forEach((coverArray, buffType) => {
		g_ctx.fillStyle = coverInfo.get(buffType)!.color;
		g_ctx.beginPath();
		coverArray.forEach((r) => {
			g_ctx.rect(r.x, r.y, r.w, r.h);
			if (interactive) testInteraction(r, undefined, onClickTimelineBackground);
		});
		g_ctx.fill();
	});

	// buffCovers
	g_ctx.fillStyle = g_colors.timeline.buffCover;
	g_ctx.beginPath();
	buffCovers.forEach((r) => {
		g_ctx.rect(r.x, r.y, r.w, r.h);
		if (interactive) testInteraction(r, undefined, onClickTimelineBackground);
	});
	g_ctx.fill();

	// icons
	g_ctx.beginPath();
	skillIcons.forEach((icon) => {
		g_ctx.drawImage(getSkillIconImage(icon.elem.skillName), icon.x, icon.y, 28, 28);
		const node = icon.elem.node;

		const lines: string[] = [];
		const buffImages: HTMLImageElement[] = [];

		// 1. description
		const description =
			localizeSkillName(icon.elem.skillName) + "@" + icon.elem.displayTime.toFixed(3);
		lines.push(description);

		// 2. potency
		if (!((node.maybeGetActionKey() ?? "NEVER") in LIMIT_BREAK_ACTIONS)) {
			if (node.getInitialPotency()) {
				const potency = node.getPotency({
					tincturePotencyMultiplier: g_renderingProps.tincturePotencyMultiplier,
					includePartyBuffs: true,
					includeSplash: true,
					untargetable: bossIsUntargetable,
				}).applied;
				lines.push(localize({ en: "potency: ", zh: "威力：" }) + potency.toFixed(2));
			}
			if (node.getInitialHealingPotency()) {
				const healingPotency = node.getHealingPotency({
					tincturePotencyMultiplier: g_renderingProps.tincturePotencyMultiplier,
					includeSplash: true,
					includePartyBuffs: true,
					untargetable: bossIsUntargetable,
				}).applied;
				lines.push(localize({ en: "healing potency: " }) + healingPotency.toFixed(2));
			}
		}

		// 3. duration
		let lockDuration = 0;
		if (node.tmp_endLockTime !== undefined && node.tmp_startLockTime !== undefined) {
			lockDuration = node.tmp_endLockTime - node.tmp_startLockTime;
		}
		lines.push(localize({ en: "duration: ", zh: "耗时：" }) + lockDuration.toFixed(3));

		// 3.5. invalid reasons
		if (node.tmp_invalid_reasons.length > 0) {
			lines.push("");
			lines.push(localize({ en: "skill is invalid:", zh: "技能有问题：" }).toString());
			node.tmp_invalid_reasons.forEach((r) =>
				lines.push("- " + localizeSkillUnavailableReason(r)),
			);
		}

		// 4. buff images
		coverInfo.forEach((info, buff) => {
			if (info.showImage && node.hasBuff(buff))
				buffImages.push(buffIconImages.get(buff) as HTMLImageElement);
		});

		node.getPartyBuffs().forEach((buffType) => {
			const img = buffIconImages.get(buffType);
			if (img) buffImages.push(img);
		});

		if (interactive) {
			testInteraction(
				{ x: icon.x, y: icon.y, w: 28, h: 28 },
				lines,
				() => {
					controller.timeline.onClickTimelineAction(
						icon.elem.actionIndex,
						g_clickEvent ? g_clickEvent.shiftKey : false,
					);
					scrollEditorToFirstSelected();
				},
				true,
				buffImages,
			);
		} else {
			testInteraction(
				{ x: icon.x, y: icon.y, w: 28, h: 28 },
				lines,
				() => {},
				false,
				buffImages,
			);
		}
	});

	// light red overlay for invalid actions
	const originalAlpha = g_ctx.globalAlpha;
	g_ctx.fillStyle = g_colors.timeline.invalidBg;
	g_ctx.globalAlpha = 0.2;
	g_ctx.beginPath();
	invalidSections.forEach((r) => {
		g_ctx.rect(r.x, r.y, r.w, r.h);
	});
	g_ctx.fill();
	g_ctx.globalAlpha = originalAlpha;
}

function drawCursor(x: number, y1: number, y2: number, y3: number, color: string, tip: string) {
	// triangle
	g_ctx.fillStyle = color;
	g_ctx.beginPath();
	g_ctx.moveTo(x - 3, 0);
	g_ctx.lineTo(x + 3, 0);
	g_ctx.lineTo(x, 6);
	g_ctx.fill();

	g_ctx.lineWidth = 1;

	// ruler
	g_ctx.strokeStyle = color;
	g_ctx.setLineDash([]);
	g_ctx.beginPath();
	g_ctx.moveTo(x, 0);
	g_ctx.lineTo(x, y1);
	g_ctx.stroke();

	// before active slot
	g_ctx.strokeStyle = color + "9f";
	g_ctx.setLineDash([2, 3]);
	g_ctx.beginPath();
	g_ctx.moveTo(x, y1);
	g_ctx.lineTo(x, y2);
	g_ctx.stroke();

	// active slot
	g_ctx.strokeStyle = color;
	g_ctx.setLineDash([]);
	g_ctx.beginPath();
	g_ctx.moveTo(x, y2);
	g_ctx.lineTo(x, y3);
	g_ctx.stroke();

	// after active slot
	g_ctx.strokeStyle = color + "9f";
	g_ctx.setLineDash([2, 3]);
	g_ctx.beginPath();
	g_ctx.moveTo(x, y3);
	g_ctx.lineTo(x, c_maxTimelineHeight);
	g_ctx.stroke();

	testInteraction({ x: x - 3, y: 0, w: 6, h: c_maxTimelineHeight }, [tip]);
	g_ctx.setLineDash([]);
}

export function drawRuler(originX: number, ignoreVisibleX = false): number {
	// If we're in image export mode, ignore the visibility limit
	const xUpperBound = ignoreVisibleX
		? StaticFn.positionFromTimeAndScale(
				controller.game.time + g_renderingProps.countdown,
				g_renderingProps.scale,
			)
		: g_visibleWidth;
	// ruler bg
	g_ctx.fillStyle = g_colors.timeline.ruler;
	g_ctx.fillRect(0, 0, xUpperBound, TimelineDimensions.rulerHeight);
	const displayTime =
		StaticFn.timeFromPositionAndScale(g_mouseX - originX, g_renderingProps.scale) -
		g_renderingProps.countdown;
	// leave the left most section not clickable
	testInteraction(
		{
			x: TimelineDimensions.leftBufferWidth,
			y: 0,
			w: xUpperBound - TimelineDimensions.leftBufferWidth,
			h: TimelineDimensions.rulerHeight,
		},
		[displayTime.toFixed(3)],
		() => {
			if (
				displayTime < controller.game.getDisplayTime() &&
				displayTime >= -controller.game.config.countdown
			) {
				controller.displayHistoricalState(displayTime, undefined); // replay the actions as-is
			} else {
				controller.displayCurrentState();
			}
		},
	);

	// ruler marks
	g_ctx.lineCap = "butt";
	g_ctx.beginPath();
	const pixelsPerSecond = g_renderingProps.scale * 100;
	const countdownPadding = g_renderingProps.countdown * pixelsPerSecond;
	g_ctx.lineWidth = 1;
	g_ctx.strokeStyle = g_colors.text;
	g_ctx.textBaseline = "alphabetic";

	g_ctx.font = "13px monospace";
	g_ctx.textAlign = "center";
	g_ctx.fillStyle = g_colors.text;
	const cullThreshold = 50;
	const drawRulerMark = function (sec: number, height: number, drawLabel: boolean) {
		const x = sec * pixelsPerSecond;
		const pos = originX + x + countdownPadding;
		if (pos >= -cullThreshold && pos <= xUpperBound + cullThreshold) {
			g_ctx.moveTo(pos, 0);
			g_ctx.lineTo(pos, height);
			if (drawLabel) {
				g_ctx.fillText(StaticFn.displayTime(x / pixelsPerSecond, 0), pos, 23);
			}
		}
	};
	if (pixelsPerSecond >= 6) {
		for (
			let sec = 0;
			sec * pixelsPerSecond < g_renderingProps.timelineWidth - countdownPadding;
			sec += 1
		) {
			if (sec % 5 !== 0) drawRulerMark(sec, 6, false);
		}
		for (let sec = -1; sec * pixelsPerSecond >= -countdownPadding; sec -= 1) {
			if (sec % 5 !== 0) drawRulerMark(sec, 6, false);
		}
	}
	for (
		let sec = 0;
		sec * pixelsPerSecond < g_renderingProps.timelineWidth - countdownPadding;
		sec += 5
	) {
		drawRulerMark(sec, 10, true);
	}
	for (let sec = -5; sec * pixelsPerSecond >= -countdownPadding; sec -= 5) {
		drawRulerMark(sec, 10, true);
	}
	g_ctx.stroke();

	return TimelineDimensions.rulerHeight;
}

export function drawMarkerTracks(originX: number, originY: number, ignoreVisibleX = false): number {
	// If we're in image export mode, ignore the visibility limit
	const xUpperBound = ignoreVisibleX
		? StaticFn.positionFromTimeAndScale(
				controller.game.time + g_renderingProps.countdown,
				g_renderingProps.scale,
			)
		: g_visibleWidth;
	// make trackbins
	const trackBins = new Map<number, MarkerElem[]>();
	g_renderingProps.allMarkers.forEach((marker) => {
		let trackBin = trackBins.get(marker.track);
		if (trackBin === undefined) trackBin = [];
		trackBin.push(marker);
		trackBins.set(marker.track, trackBin);
	});

	// tracks background
	g_ctx.beginPath();
	let numTracks = 0;
	let hasUntargetableTrack = false;
	for (const k of trackBins.keys()) {
		numTracks = Math.max(numTracks, k + 1);
		if (k === UntargetableMarkerTrack) hasUntargetableTrack = true;
	}
	if (hasUntargetableTrack) numTracks += 1;
	const markerTracksBottomY = originY + numTracks * TimelineDimensions.trackHeight;
	g_ctx.fillStyle = g_colors.timeline.tracks;
	for (let i = 0; i < numTracks; i += 2) {
		const top = markerTracksBottomY - (i + 1) * TimelineDimensions.trackHeight;
		g_ctx.rect(0, top, xUpperBound, TimelineDimensions.trackHeight);
	}
	g_ctx.fill();

	// timeline markers
	drawMarkers(
		g_renderingProps.countdown,
		g_renderingProps.scale,
		originY,
		markerTracksBottomY,
		originX,
		trackBins,
	);

	return numTracks * TimelineDimensions.trackHeight;
}

export function drawTimelines(
	originX: number,
	originY: number,
	isImageExportMode: boolean,
): number {
	// fragCoord.x of displayTime=0
	const displayOriginX =
		originX +
		StaticFn.positionFromTimeAndScale(g_renderingProps.countdown, g_renderingProps.scale);

	for (let slot = 0; slot < g_renderingProps.slots.length; slot++) {
		const isActiveSlot = slot === g_renderingProps.activeSlotIndex;
		const elemBins = new Map<ElemType, TimelineElem[]>();
		if (isImageExportMode && !isActiveSlot) {
			// Only draw the active timeline in export mode
			continue;
		}
		g_renderingProps.slots[slot].elements.forEach((e) => {
			const arr = elemBins.get(e.type) ?? [];
			arr.push(e);
			elemBins.set(e.type, arr);
		});
		let currentY = originY + slot * TimelineDimensions.renderSlotHeight();
		if (isImageExportMode) {
			// Only draw the active timeline in export mode
			currentY = originY;
		}

		// mp tick marks
		if (g_renderingProps.drawOptions.drawMPTickMarks) {
			drawMPTickMarks(
				g_renderingProps.countdown,
				g_renderingProps.scale,
				displayOriginX,
				currentY,
				(elemBins.get(ElemType.MPTickMark) as MPTickMarkElem[]) ?? [],
			);
		}

		// healing marks
		if (g_renderingProps.drawOptions.drawHealingMarks) {
			drawPotencyMarks(
				g_renderingProps.countdown,
				g_renderingProps.scale,
				displayOriginX,
				currentY,
				(elemBins.get(ElemType.HealingMark) as PotencyMarkElem[]) ?? [],
			);
		}

		// damage marks
		if (g_renderingProps.drawOptions.drawDamageMarks) {
			drawPotencyMarks(
				g_renderingProps.countdown,
				g_renderingProps.scale,
				displayOriginX,
				currentY,
				(elemBins.get(ElemType.DamageMark) as PotencyMarkElem[]) ?? [],
			);

			drawPotencyMarks(
				g_renderingProps.countdown,
				g_renderingProps.scale,
				displayOriginX,
				currentY,
				(elemBins.get(ElemType.AggroMark) as PotencyMarkElem[]) ?? [],
			);
		}

		// lucid marks
		if (g_renderingProps.drawOptions.drawMPTickMarks) {
			drawLucidMarks(
				g_renderingProps.countdown,
				g_renderingProps.scale,
				displayOriginX,
				currentY,
				(elemBins.get(ElemType.LucidMark) as LucidMarkElem[]) ?? [],
			);
		}

		// always draw meditate tick marks
		drawMeditateTickMarks(
			g_renderingProps.countdown,
			g_renderingProps.scale,
			displayOriginX,
			currentY,
			(elemBins.get(ElemType.MeditateTickMark) as MeditateTickMarkElem[]) ?? [],
		);

		// draw auto tick marks here
		drawAutoTickMarks(
			g_renderingProps.countdown,
			g_renderingProps.scale,
			displayOriginX,
			currentY,
			(elemBins.get(ElemType.AutoTickMark) as AutoTickMarkElem[]) ?? [],
		);

		// warning marks (polyglot overcap)
		drawWarningMarks(
			g_renderingProps.countdown,
			g_renderingProps.scale,
			displayOriginX,
			currentY,
			(elemBins.get(ElemType.WarningMark) as WarningMarkElem[]) ?? [],
		);

		// skills
		drawSkills(
			g_renderingProps.countdown,
			g_renderingProps.scale,
			displayOriginX,
			currentY,
			(elemBins.get(ElemType.Skill) as SkillElem[]) ?? [],
			isActiveSlot,
		);

		// selection rect
		if (g_renderingProps.showSelection && isActiveSlot && !isImageExportMode) {
			g_ctx.fillStyle = "rgba(147, 112, 219, 0.15)";
			const selectionLeftPx =
				displayOriginX +
				StaticFn.positionFromTimeAndScale(
					g_renderingProps.selectionStartDisplayTime,
					g_renderingProps.scale,
				);
			const selectionWidthPx = StaticFn.positionFromTimeAndScale(
				g_renderingProps.selectionEndDisplayTime -
					g_renderingProps.selectionStartDisplayTime,
				g_renderingProps.scale,
			);
			g_ctx.fillRect(
				selectionLeftPx,
				currentY,
				selectionWidthPx,
				TimelineDimensions.renderSlotHeight(),
			);
			g_ctx.strokeStyle = "rgba(147, 112, 219, 0.5)";
			g_ctx.lineWidth = 1;
			g_ctx.beginPath();
			g_ctx.moveTo(selectionLeftPx, currentY);
			g_ctx.lineTo(selectionLeftPx, currentY + TimelineDimensions.renderSlotHeight());
			g_ctx.moveTo(selectionLeftPx + selectionWidthPx, currentY);
			g_ctx.lineTo(
				selectionLeftPx + selectionWidthPx,
				currentY + TimelineDimensions.renderSlotHeight(),
			);
			g_ctx.stroke();
		}
	}
	// countdown grey rect
	const countdownWidth = StaticFn.positionFromTimeAndScale(
		g_renderingProps.countdown,
		g_renderingProps.scale,
	);
	let countdownHeight = TimelineDimensions.renderSlotHeight() * g_renderingProps.slots.length;
	if (g_renderingProps.slots.length < MAX_TIMELINE_SLOTS)
		countdownHeight += TimelineDimensions.addSlotButtonHeight;
	g_ctx.fillStyle = g_colors.timeline.countdown;
	// make it cover the left padding as well:
	g_ctx.fillRect(
		originX - TimelineDimensions.leftBufferWidth,
		originY,
		countdownWidth + TimelineDimensions.leftBufferWidth,
		countdownHeight,
	);

	if (isImageExportMode) {
		// In image export mode, don't render slot selection bars
		return TimelineDimensions.renderSlotHeight();
	}

	// slot selection bars
	for (let slot = 0; slot < g_renderingProps.slots.length; slot++) {
		const currentY = originY + slot * TimelineDimensions.renderSlotHeight();
		const handle: Rect = {
			x: 0,
			y: currentY + 1,
			w: 14,
			h: TimelineDimensions.renderSlotHeight() - 2,
		};
		g_ctx.fillStyle =
			slot === g_renderingProps.activeSlotIndex ? g_colors.accent : g_colors.bgMediumContrast;
		g_ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
		testInteraction(
			handle,
			slot === g_renderingProps.activeSlotIndex
				? undefined
				: [localize({ en: "set active", zh: "设为当前" }) as string],
			() => {
				controller.setActiveSlot(slot);
			},
			true,
		);

		// delete btn
		if (g_renderingProps.slots.length > 1 && slot === g_renderingProps.activeSlotIndex) {
			g_ctx.fillStyle = g_colors.emphasis;
			g_ctx.font = "bold 14px monospace";
			g_ctx.textAlign = "center";
			g_ctx.fillText("×", handle.x + handle.w / 2, handle.y + handle.h - 4);
			const deleteBtn: Rect = {
				x: handle.x,
				y: handle.y + handle.h - handle.w,
				w: handle.w,
				h: handle.w,
			};
			testInteraction(
				deleteBtn,
				[localize({ en: "delete", zh: "删除" }) as string],
				() => {
					controller.timeline.removeSlot(slot);
					controller.displayCurrentState();
				},
				true,
			);
		}
	}
	return TimelineDimensions.renderSlotHeight() * g_renderingProps.slots.length;
}

function drawCursors(originX: number, timelineStartY: number) {
	// fragCoord.x of displayTime=0
	const displayOriginX =
		originX +
		StaticFn.positionFromTimeAndScale(g_renderingProps.countdown, g_renderingProps.scale);
	const slotHeight = TimelineDimensions.renderSlotHeight();
	const activeSlotStartY = timelineStartY + g_renderingProps.activeSlotIndex * slotHeight;

	const sharedElemBins = new Map<ElemType, TimelineElem[]>();
	g_renderingProps.sharedElements.forEach((e) => {
		const arr = sharedElemBins.get(e.type) ?? [];
		arr.push(e);
		sharedElemBins.set(e.type, arr);
	});

	// view only cursor
	(sharedElemBins.get(ElemType.s_ViewOnlyCursor) ?? []).forEach((cursor) => {
		const vcursor = cursor as ViewOnlyCursorElem;
		if (vcursor.enabled) {
			const x =
				displayOriginX +
				StaticFn.positionFromTimeAndScale(cursor.displayTime, g_renderingProps.scale);
			drawCursor(
				x,
				timelineStartY,
				activeSlotStartY,
				activeSlotStartY + slotHeight,
				g_colors.historical,
				localize({ en: "cursor: ", zh: "光标：" }) + vcursor.displayTime.toFixed(3),
			);
		}
	});

	// cursor
	(sharedElemBins.get(ElemType.s_Cursor) ?? []).forEach((elem) => {
		const cursor = elem as CursorElem;
		const x =
			displayOriginX +
			StaticFn.positionFromTimeAndScale(cursor.displayTime, g_renderingProps.scale);
		drawCursor(
			x,
			timelineStartY,
			activeSlotStartY,
			activeSlotStartY + slotHeight,
			g_colors.emphasis,
			localize({ en: "cursor: ", zh: "光标：" }) + cursor.displayTime.toFixed(3),
		);
	});

	return 0;
}

function drawAddSlotButton(originY: number) {
	if (g_renderingProps.slots.length < MAX_TIMELINE_SLOTS) {
		// "Add timeline slot" button
		const BUTTON_W_PX = 192;
		const BUTTON_LEFT_MARGIN_PX = 4;
		const handle: Rect = {
			x: BUTTON_LEFT_MARGIN_PX,
			y: originY + 2,
			w: BUTTON_W_PX,
			h: TimelineDimensions.addSlotButtonHeight - 4,
		};
		g_ctx.fillStyle = g_colors.bgLowContrast;
		g_ctx.fillRect(handle.x, handle.y, handle.w, handle.h);
		g_ctx.strokeStyle = g_colors.bgHighContrast;
		g_ctx.lineWidth = 1;
		g_ctx.strokeRect(handle.x, handle.y, handle.w, handle.h);
		g_ctx.font = "13px monospace";
		g_ctx.fillStyle = g_colors.text;
		g_ctx.textAlign = "center";
		g_ctx.fillText(
			localize({ en: "Add timeline slot", zh: "添加时间轴" }) as string,
			handle.x + handle.w / 2,
			handle.y + handle.h - 4,
		);

		testInteraction(
			handle,
			undefined,
			() => {
				controller.timeline.addSlot();
				controller.displayCurrentState();
			},
			true,
		);

		// "Clone timeline slot" button
		const cloneHandle: Rect = {
			x: 2 * BUTTON_LEFT_MARGIN_PX + BUTTON_W_PX,
			y: originY + 2,
			w: BUTTON_W_PX,
			h: TimelineDimensions.addSlotButtonHeight - 4,
		};
		g_ctx.fillStyle = g_colors.bgLowContrast;
		g_ctx.fillRect(cloneHandle.x, cloneHandle.y, cloneHandle.w, cloneHandle.h);
		g_ctx.strokeStyle = g_colors.bgHighContrast;
		g_ctx.lineWidth = 1;
		g_ctx.strokeRect(cloneHandle.x, cloneHandle.y, cloneHandle.w, cloneHandle.h);
		g_ctx.font = "13px monospace";
		g_ctx.fillStyle = g_colors.text;
		g_ctx.textAlign = "center";
		g_ctx.fillText(
			localize({ en: "Clone timeline slot", zh: "复制时间轴" }) as string,
			cloneHandle.x + cloneHandle.w / 2,
			cloneHandle.y + cloneHandle.h - 4,
		);

		testInteraction(
			cloneHandle,
			undefined,
			() => {
				controller.cloneActiveSlot();
				controller.displayCurrentState();
			},
			true,
		);

		return TimelineDimensions.addSlotButtonHeight;
	}
	return 0;
}

// background layer:
// white bg, tracks bg, ruler bg, ruler marks, numbers on ruler: update only when canvas size change, countdown grey
function drawEverything() {
	const timelineOrigin = -g_visibleLeft + TimelineDimensions.leftBufferWidth; // fragCoord.x (...) of rawTime=0.
	let currentHeight = 0;

	// background white
	g_ctx.fillStyle = g_colors.background;
	// add 1 here because this scaled dimension from dpr may not perfectly cover the entire canvas
	g_ctx.fillRect(0, 0, g_visibleWidth + 1, g_renderingProps.timelineHeight + 1);
	testInteraction(
		{ x: 0, y: 0, w: g_visibleWidth, h: c_maxTimelineHeight },
		undefined,
		onClickTimelineBackground,
	);

	currentHeight += drawRuler(timelineOrigin);

	currentHeight += drawMarkerTracks(timelineOrigin, currentHeight);
	const timelineStartY = currentHeight;

	currentHeight += drawTimelines(timelineOrigin, currentHeight, false);

	currentHeight += drawCursors(timelineOrigin, timelineStartY);

	currentHeight += drawAddSlotButton(currentHeight);

	// interactive layer
	if (g_mouseHovered) {
		if (g_activeHoverTip) {
			drawTip(
				g_activeHoverTip,
				g_visibleWidth,
				g_renderingProps.timelineHeight,
				g_activeHoverTipImages,
			);
		}
		if (g_isClickUpdate && g_activeOnClick) {
			g_activeOnClick();
		}
	}
}

// (layers for optimization, in case one day rendering becomes the performance bottleneck again: )
// background layer: white bg, tracks bg, ruler bg, ruler marks, numbers on ruler: update only when canvas size change, countdown grey
// skills, damage marks, mp and lucid ticks: update when new elems added
// cursor, selection: can update in real time; on top of everything else
// transparent interactive layer: only render when not in real time, html DOM

export let timelineCanvasOnMouseMove: (x: number, y: number) => void = (x: number, y: number) => {};
export let timelineCanvasOnMouseEnter: () => void = () => {};
export let timelineCanvasOnMouseLeave: () => void = () => {};
export let timelineCanvasOnClick: (e: any) => void = (e: any) => {};
export let timelineCanvasOnKeyDown: (e: any) => void = (e: any) => {};

export const timelineCanvasGetPointerMouse: () => boolean = () => {
	return readback_pointerMouse;
};

export function TimelineCanvas(props: {
	timelineHeight: number;
	visibleLeft: number;
	visibleWidth: number;
	version: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const dpr = window.devicePixelRatio;
	const scaledWidth = props.visibleWidth * dpr;
	const scaledHeight = props.timelineHeight * dpr;

	const [mouseX, setMouseX] = useState(0);
	const [mouseY, setMouseY] = useState(0);
	const [mouseHovered, setMouseHovered] = useState(false);
	const [clickCounter, setClickCounter] = useState(0);
	const [keyCounter, setKeyCounter] = useState(0);
	const activeColorTheme = useContext(ColorThemeContext);

	// initialization
	useEffect(() => {
		timelineCanvasOnMouseMove = (x: number, y: number) => {
			g_mouseX = x;
			g_mouseY = y;
			setMouseX(g_mouseX);
			setMouseY(g_mouseY);
		};
		timelineCanvasOnMouseEnter = () => {
			setMouseHovered(true);
			g_mouseHovered = true;
		};
		timelineCanvasOnMouseLeave = () => {
			setMouseHovered(false);
			g_mouseHovered = false;
		};
		// ignore KB & M input when in the middle of using a skill (for simplicity)
		timelineCanvasOnClick = (e: any) => {
			if (!controller.shouldLoop) {
				setClickCounter((c) => c + 1);
				g_isClickUpdate = true;
				g_clickEvent = e;
			}
		};
		timelineCanvasOnKeyDown = (e: any) => {
			if (!controller.shouldLoop) {
				setKeyCounter((k) => k + 1);
				g_keyboardEvent = e;
				if (g_keyboardEvent.key === "Backspace" || g_keyboardEvent.key === "Delete") {
					const firstSelected = controller.record.selectionStartIndex;
					if (firstSelected !== undefined) {
						controller.deleteSelectedSkill();
					}
				}
			}
		};
	}, []);

	useEffect(() => {
		g_activeHoverTip = undefined;
		g_activeOnClick = undefined;
		g_visibleLeft = props.visibleLeft;
		g_visibleWidth = props.visibleWidth;
		g_colors = getThemeColors(activeColorTheme);

		cachedPointerMouse = readback_pointerMouse;

		// gather global values
		g_renderingProps = controller.getTimelineRenderingProps();

		// draw
		const currentContext = canvasRef.current?.getContext("2d", { alpha: false });
		if (currentContext) {
			g_ctx = currentContext;
			g_ctx.scale(dpr, dpr);
			drawEverything();
			g_ctx.scale(1 / dpr, 1 / dpr);
		}

		// potential update due to pointer change
		if (cachedPointerMouse !== readback_pointerMouse) {
			updateTimelineView();
		}

		// reset event flags
		g_isClickUpdate = false;
	}, [
		// update when dependency props change
		props.visibleLeft,
		props.visibleWidth,
		mouseX,
		mouseY,
		mouseHovered,
		clickCounter,
		keyCounter,
		props.version,
		dpr,
	]);

	return <canvas
		ref={canvasRef}
		width={Math.ceil(scaledWidth)}
		height={Math.ceil(scaledHeight)}
		tabIndex={0}
		style={{
			width: props.visibleWidth,
			height: props.timelineHeight,
			position: "absolute",
			pointerEvents: "none",
			cursor: readback_pointerMouse ? "pointer" : "default",
		}}
	/>;
}

/**
 * Save the current g_ctx, execute a callback, then restore the saved g_ctx.
 */
export function swapCtx(new_ctx: CanvasRenderingContext2D, callback: () => void) {
	const temp_ctx = g_ctx;
	g_ctx = new_ctx;
	callback();
	g_ctx = temp_ctx;
}
