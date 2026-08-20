import { Injectable } from '@nestjs/common';
import { Expression, ExpressionBuilder, Insertable, Kysely, QueryCreator, Selectable, sql, SqlBool } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetFileType, AssetType, AssetVisibility } from 'src/enum';
import { DB } from 'src/schema';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';
import { GameGuessTable } from 'src/schema/tables/game-guess.table';
import { GameRoundTable } from 'src/schema/tables/game-round.table';
import { asUuid, asVector } from 'src/utils/database';
import { GameCandidate } from 'src/utils/game-scoring';
import { eligibleSoloAsset, soloPoolAssetIdUnion, SoloPoolSources } from 'src/utils/game-solo-eligibility';
import { spaceAssetIdUnion, spaceAssetPathBranches } from 'src/utils/shared-space-album-scope';

export type GameChallengeRow = Selectable<GameChallengeTable>;
export type GameRoundRow = Selectable<GameRoundTable>;
export type GameGuessRow = Selectable<GameGuessTable>;

/**
 * One row of a player's own game history: the challenge, plus what they scored on it.
 *
 * Not a `GameChallengeRow` with extras - a history row carries neither scope column (it is the
 * caller's own, by construction) nor the frozen source toggles, which are generation inputs rather
 * than anything a player browses.
 */
export type GameSoloHistoryRow = {
  id: string;
  name: string;
  /** The UTC calendar day this was the daily for, or null for a free-play game. */
  dailyOn: string | null;
  createdAt: Date;
  roundCount: number;
  answered: number;
  total: number;
};

/**
 * The two CLIP text vectors the scene gate ranks against. Supplied by the caller rather than
 * read from the constants below, because `machineLearning.clip.modelName` is admin-configurable
 * and `DatabaseRepository.setDimensionSize` re-types `smart_search.embedding` when it changes -
 * a hardcoded 512-dim ViT-B-32 vector either errors outright against a 768-dim model or, worse,
 * silently dot-products against an unrelated embedding space. `undefined` means "no usable
 * prompt vectors for the configured model": the gate's ordering is then skipped entirely rather
 * than run against nonsense. See GameService.getScenePromptEmbeddings.
 */
export type ScenePromptEmbeddings = { place: number[]; notPlace: number[] };

// A face covering more than this fraction of the frame marks the shot as a portrait rather
// than a place - see the doc comment on rankLocationSample for the measurement behind it.
const MAX_FACE_AREA_RATIO = 0.05;

/**
 * How many eligible rows stage 1 samples before stage 2 ranks them.
 *
 * MEASURED, not guessed - see design §4.4. Against 27,227 gated candidates on the reference
 * library, this retains 91% of the mean placeyness score of a full ranking, and the worst photo
 * the downstream rank-biased draw can reach sits at global rank 302 (top 1.1%). Dropping to 2,000
 * moves that to rank 692; raising to 8,000 buys rank 150 for 2.3x the time. 4,000 is the knee.
 *
 * The cost of getting this wrong is asymmetric: too small silently degrades round quality in a
 * way no test catches, too large reintroduces the cold-cache cliff. Re-run the sweep before
 * changing it.
 */
export const LOCATION_SAMPLE_SIZE = 4000;

/**
 * CLIP text embedding for "an outdoor photo that shows where it was taken", encoded with
 * ViT-B-32__openai - the model Gallery's smart search uses. Paired with
 * NOT_PLACE_PROMPT_EMBEDDING below; see rankLocationSample for why both are needed.
 *
 * Regenerate with, from machine-learning/:
 *   uv run --project machine-learning python -c "from immich_ml.models.clip.textual import OpenClipTextualEncoder; \
 *     m = OpenClipTextualEncoder('ViT-B-32__openai'); m.load(); \
 *     print(m.predict('an outdoor photo that shows where it was taken'))"
 */
export const PLACE_PROMPT_EMBEDDING: number[] = [
  -0.03565011, 0.04119933, 0.01333595, -0.01572146, 0.00014742, -0.01074514, -0.00938183, -0.10144751, 0.01633137,
  -0.00570935, 0.01585284, -0.02488416, 0.01326679, -0.02903384, 0.0031385, -0.0092501, 0.00491203, 0.03014844,
  0.0154667, 0.01722844, 0.06752882, -0.00456453, 0.01514293, -0.02354148, 0.0192754, -0.00704748, -0.02427393,
  -0.00363509, -0.01776161, -0.02864841, -0.01343763, 0.01432632, 0.0097616, -0.01000545, -0.01486041, -0.00378936,
  0.01796454, -0.0173474, -0.01160319, 0.05725082, -0.00485439, 0.02071633, 0.02593069, 0.01364317, 0.01745008,
  -0.02577067, 0.01379383, 0.02026937, 0.00417087, 0.0108376, 0.01115624, -0.00470062, 0.00473881, -0.02181567,
  -0.02316737, -0.00334229, -0.02153531, 0.02684961, 0.01777776, -0.00170086, 0.01424351, -0.03169496, 0.01697521,
  0.00513031, 0.01008756, -0.01758164, -0.00079429, 0.02032729, -0.01775224, -0.0060782, -0.02640892, -0.02896196,
  -0.05269371, 0.02443811, -0.00373854, -0.02002827, 0.04337476, 0.01313461, 0.01697449, -0.01724268, 0.0169794,
  0.01263569, 0.01476912, -0.01922106, -0.00059291, 0.00326119, -0.00301224, -0.00345135, 0.03339328, 0.00993915,
  0.02955169, -0.01912368, -0.1368987, 0.03298316, 0.01600578, -0.00045929, -0.03521221, 0.0081017, -0.01914166,
  -0.04802696, -0.01550323, -0.00752189, -0.01554134, 0.00437131, 0.00009113, -0.03753269, -0.01551559, 0.03279093,
  0.03515922, 0.00420018, -0.03761362, -0.05966753, -0.00693837, 0.01753425, -0.02956902, 0.00672304, 0.02304751,
  0.01418293, -0.00864077, 0.02256521, 0.03284034, -0.02263047, 0.00729757, -0.04204169, 0.01333652, 0.01281837,
  -0.01987715, -0.02237567, -0.0145562, 0.05693359, 0.01547049, -0.02298284, -0.02497104, 0.57325917, -0.02129506,
  0.01973542, 0.0017443, -0.03539589, 0.00505409, 0.01194552, -0.00532682, 0.00342391, -0.05141503, 0.03160568,
  0.0196205, -0.01525842, 0.01461286, -0.02115116, -0.00516747, -0.000298, -0.01774376, -0.00489959, 0.02788112,
  0.00509321, 0.03923067, -0.01367269, -0.01176961, 0.01580284, 0.00516844, 0.01547243, 0.00259872, -0.00836698,
  -0.02149737, -0.02818627, 0.01809538, 0.02233366, 0.04570988, 0.00894792, -0.00906434, -0.0032996, -0.02596167,
  -0.02552693, -0.01541364, -0.00362549, -0.01417085, -0.00789733, 0.00244975, 0.02079234, -0.01666823, -0.01066814,
  -0.02111618, -0.00501444, -0.02884045, -0.01028973, -0.03450879, 0.02706483, -0.02533589, -0.03977542, 0.0168976,
  0.02547891, 0.02856828, 0.00295601, 0.03053878, -0.01188758, -0.04223999, 0.0129645, 0.01642841, -0.02450766,
  -0.00613648, -0.00313555, -0.00820707, 0.00286439, 0.00388309, 0.04685178, 0.01969445, -0.02145819, 0.02995754,
  -0.03644379, 0.01087859, 0.02312868, 0.00517449, 0.00625752, -0.01269547, 0.05175751, 0.01708674, 0.01131673,
  -0.00847883, -0.01709724, -0.03306906, 0.02226213, 0.00258377, -0.00729825, -0.00060625, -0.00989763, -0.01128472,
  -0.00269302, -0.0080765, -0.00441235, -0.0264556, 0.00322071, 0.00354458, -0.00548854, 0.00133255, 0.01442194,
  0.02672829, -0.01541648, -0.01288324, -0.00647826, -0.02152042, -0.01647528, 0.01507615, 0.01227487, -0.03837489,
  0.02895872, 0.00182888, 0.01487559, 0.04642617, 0.03986979, -0.03662466, -0.00954801, -0.0081344, -0.01499752,
  0.01952527, -0.01981483, -0.00753664, 0.00218387, -0.00862531, -0.01012128, 0.06705435, 0.04260367, 0.00891241,
  0.03467292, 0.00511627, -0.01061139, -0.00989996, -0.00052099, 0.00629362, -0.00984653, 0.00532146, -0.0080895,
  -0.00151943, 0.02221185, 0.01324994, -0.00758895, 0.00470217, 0.02987928, -0.01447782, 0.00225108, 0.03452649,
  -0.02080118, -0.00822271, 0.00968781, 0.01840568, 0.01259417, 0.00629021, 0.03243105, -0.00499793, 0.01049649,
  0.03372281, -0.0093778, -0.00325473, 0.02137516, -0.01295912, 0.00613091, 0.01010848, -0.01979412, 0.01407333,
  -0.00024641, 0.01543495, 0.00837985, 0.02815301, 0.00351987, -0.02768026, -0.01530652, -0.03475158, -0.03886753,
  0.00784356, 0.00353163, 0.0352168, 0.02944364, 0.01521325, -0.01859849, 0.57271135, -0.01167175, 0.01548798,
  -0.01337727, -0.01429647, 0.02127417, 0.03816451, 0.02730765, 0.00344544, 0.02227476, 0.02520717, -0.01569453,
  -0.05453049, -0.01031092, -0.02036737, -0.00302029, 0.00727488, -0.19261433, 0.0011036, 0.0244845, 0.04317967,
  -0.00776433, 0.01035016, -0.02418255, 0.04174931, 0.00658663, 0.02920964, -0.00182587, 0.01774054, -0.01215491,
  0.02723038, -0.0153521, 0.00715404, -0.02627724, 0.00029763, 0.01728641, -0.00171982, -0.02573624, 0.02256717,
  -0.01383729, 0.02384946, 0.02505303, -0.03766847, -0.00638346, 0.02317786, 0.00651214, -0.01165954, -0.00201343,
  0.00439168, -0.02203845, 0.00346685, 0.01925999, -0.03510653, 0.00964268, 0.00923398, 0.00135642, -0.00236627,
  0.01999338, -0.02531821, -0.01992169, -0.01954874, 0.00950056, 0.00502003, -0.02159357, 0.0222213, -0.00891244,
  -0.01077263, -0.00482766, 0.05029133, 0.04116416, 0.02540104, -0.02233087, -0.00124202, -0.01086042, -0.03249955,
  -0.0114133, -0.02900061, 0.00290873, -0.08172268, 0.02701079, -0.02618168, 0.01003767, 0.00611602, 0.02087832,
  0.00393038, 0.00031947, -0.00318548, -0.01173826, 0.02778, 0.00605681, 0.01739915, 0.02690274, -0.00985536,
  -0.02601787, 0.00984417, 0.0042631, 0.01742411, -0.00582852, -0.00528874, -0.03026248, -0.00705265, -0.00616391,
  0.01463998, 0.0172171, 0.00304002, -0.01359662, 0.02097134, 0.00542725, 0.06238439, -0.04048368, 0.03980203,
  -0.07002119, 0.01144235, 0.00337658, -0.02945969, 0.01772812, 0.02449782, 0.01382573, 0.01919165, 0.01017774,
  0.0021893, -0.04589008, -0.01634806, -0.01878912, -0.00476136, 0.01331673, 0.02322203, 0.02022227, -0.02594628,
  0.00634721, 0.01030519, -0.03688602, -0.0040136, -0.02633961, 0.00617153, -0.03702287, 0.0246152, 0.04485991,
  -0.06056247, 0.0224271, -0.01869726, -0.00165792, -0.02130081, -0.0112317, 0.03358975, -0.0038052, -0.01208503,
  -0.0312748, -0.02541404, 0.00703386, 0.00832212, 0.04617887, 0.0051285, 0.0453952, -0.02346631, -0.02396337,
  -0.03237309, -0.03037936, 0.015901, -0.01390338, 0.01524195, -0.02731557, 0.02373794, 0.00475458, 0.02459203,
  -0.023426, -0.03376574, 0.02028145, 0.01253085, -0.1081608, 0.04907747, 0.00486162, 0.04648707, -0.02634849,
  0.00077304, 0.01293567, 0.03034823, -0.01349263, 0.01749041, -0.02974608, 0.04520539, 0.05770895, 0.00785155,
  0.01517758, 0.0127582, -0.01032453, -0.00929551, 0.01217034, 0.01887272, 0.02208971, 0.00597955, 0.02339009,
  0.07025582, 0.01280948, 0.02993186, -0.007097, -0.01964995, -0.07739552, -0.01471389, -0.0121104,
];

/**
 * CLIP text embedding for "a close-up of a person or an indoor room", encoded the same way as
 * PLACE_PROMPT_EMBEDDING (ViT-B-32__openai). See rankLocationSample for how it is used.
 *
 * Regenerate with, from machine-learning/:
 *   uv run --project machine-learning python -c "from immich_ml.models.clip.textual import OpenClipTextualEncoder; \
 *     m = OpenClipTextualEncoder('ViT-B-32__openai'); m.load(); \
 *     print(m.predict('a close-up of a person or an indoor room'))"
 */
export const NOT_PLACE_PROMPT_EMBEDDING: number[] = [
  0.00499068, 0.01676853, 0.01774894, 0.01421952, -0.00543273, -0.02298078, -0.00498926, -0.08493787, -0.03860839,
  0.02356507, 0.01267078, -0.01815343, 0.01747182, 0.00334179, -0.00219845, -0.00431961, 0.02201596, 0.00739468,
  -0.00624563, 0.02471453, 0.03840766, 0.00222552, 0.02622628, -0.00943226, -0.03717678, 0.02235266, 0.00690686,
  0.01781799, -0.01523419, -0.00818739, 0.05583083, -0.01627958, -0.01217731, 0.00882362, -0.01437743, -0.02139949,
  0.02257989, -0.03144243, -0.03668782, -0.00959044, 0.00659652, -0.01683651, -0.04046286, 0.03330789, 0.02274995,
  -0.00153706, -0.02735649, 0.02660811, -0.03213148, 0.0245413, -0.02379678, -0.01452899, 0.00839827, -0.01315032,
  -0.02433945, -0.02913877, -0.01113416, 0.01168093, -0.00285383, -0.02353719, 0.05495016, 0.00821668, -0.00129711,
  -0.01096784, -0.00219558, -0.0017068, -0.00748336, 0.00775258, 0.00411402, -0.01048065, -0.02025758, -0.03019106,
  -0.01559553, 0.00133022, -0.00980256, 0.02414393, 0.02568031, 0.01231696, 0.00576614, -0.0418281, -0.02278911,
  -0.00025097, -0.0278212, 0.00366628, 0.00013374, 0.01710985, 0.06793708, 0.00371683, -0.01104862, 0.01500127,
  0.00777547, -0.02272478, -0.14902355, 0.00082254, 0.02559667, -0.00389556, 0.03804256, -0.01426474, 0.02843362,
  -0.01301594, 0.01959088, 0.02437085, 0.05381303, 0.01657947, -0.01849251, -0.02783064, -0.01341908, 0.01080868,
  0.00808432, 0.0065203, 0.00334005, -0.01859339, -0.00671069, 0.02246239, 0.00042222, -0.01478708, -0.00159055,
  -0.00363028, 0.01731975, 0.01204036, -0.00194085, -0.04293044, 0.0224578, 0.00521225, 0.01836793, -0.02823189,
  -0.04263729, -0.02687893, -0.01192167, 0.03643989, 0.0083533, -0.04224554, -0.01870756, 0.57167578, -0.01354722,
  0.00662591, -0.0192761, -0.01885469, -0.0004145, -0.04334338, -0.0062521, 0.03305725, -0.04324888, 0.02415036,
  0.01161697, 0.00279526, 0.00787274, -0.06507976, -0.00363148, -0.00522054, -0.01254025, -0.00725958, 0.0184439,
  0.02032097, -0.02336169, -0.04318334, -0.00240307, -0.02298763, 0.00672544, 0.00932529, -0.01175196, -0.01786065,
  -0.05636103, -0.0395234, -0.03143852, 0.00103145, -0.00692399, 0.02264861, 0.01100259, -0.00249052, 0.01464831,
  -0.02250617, -0.00678741, 0.00102582, 0.007507, -0.00583296, -0.00751295, 0.01454266, 0.01258856, -0.00747909,
  -0.00728146, -0.00193591, 0.00593682, -0.01548694, -0.07337853, 0.01374464, 0.00261108, -0.02744343, 0.01162509,
  0.00580418, 0.03012566, 0.02573866, -0.01325675, -0.01948425, 0.0426581, 0.01464763, 0.01496633, 0.02042549,
  -0.05863054, 0.01790393, -0.00447702, 0.00434461, -0.01354767, 0.05793799, 0.00642729, -0.02073517, -0.00348909,
  -0.04924462, -0.01087034, 0.00724102, -0.00231852, 0.00990648, 0.00229773, 0.03585136, 0.01672505, -0.0174989,
  0.0193256, -0.00569454, 0.01784368, 0.01261739, 0.02682391, 0.01149951, -0.03354555, -0.0438417, 0.00657066,
  -0.01760186, 0.01610183, 0.01079252, -0.002526, -0.0209553, 0.00766297, -0.00499994, 0.02046581, -0.03319299,
  0.04841204, 0.00985947, -0.0021672, 0.01917944, -0.00074544, -0.00422848, 0.00877089, 0.00455714, 0.00129543,
  0.00717554, -0.01559418, 0.034906, -0.00162567, 0.00026964, -0.01504279, -0.02577666, -0.03659505, -0.01561173,
  0.01418338, 0.00471486, -0.00967715, -0.0029456, 0.00450604, -0.04707296, -0.02236751, 0.04615192, 0.0083386,
  -0.00304826, 0.03064076, -0.01196138, -0.00785356, 0.01304492, 0.01981447, 0.01854688, -0.00776941, 0.01114016,
  -0.02489028, -0.00219987, 0.00786067, -0.0244182, -0.02482546, 0.01911989, 0.01484486, 0.01952244, 0.02265968,
  -0.01433376, 0.02145316, -0.03156412, 0.04414507, 0.04407892, 0.01008628, 0.04889466, -0.02840327, -0.00188268,
  -0.01283382, -0.04194267, 0.00113203, -0.00724659, 0.06023359, 0.06804467, -0.00228, 0.0326224, -0.03774272,
  0.02267313, 0.01661863, 0.00929053, 0.00417246, 0.0050409, -0.02227189, 0.0438426, 0.0265494, -0.00394396,
  -0.01030146, 0.01086017, 0.01705457, 0.0119889, 0.01578316, 0.02190566, 0.57158995, 0.02027945, 0.00426042,
  0.03882293, 0.0196687, 0.00239701, 0.02692918, -0.01972526, -0.00507183, 0.0322121, 0.01887202, 0.01773559,
  -0.00707932, -0.01234239, -0.00109019, -0.03032061, 0.00557411, -0.16234888, 0.00687283, 0.06850953, -0.00042395,
  -0.01979411, -0.04934375, 0.01417759, -0.01005549, 0.02129199, -0.0152379, -0.00438842, 0.02017439, 0.01126768,
  0.04196106, 0.01350462, -0.00533116, -0.01534032, -0.00949103, 0.05612484, 0.00997827, -0.00723835, 0.02215079,
  0.01115607, 0.01922809, -0.0009568, -0.01488468, -0.02657908, -0.01884833, 0.02087243, -0.00756608, 0.01254074,
  -0.03094159, -0.03202398, 0.00937415, 0.01136758, -0.00181953, -0.02682307, 0.01591562, -0.04449606, 0.00982043,
  -0.01937127, 0.00027583, -0.01697211, -0.0085707, 0.01646928, 0.02572413, 0.02415506, 0.01599057, -0.05290264,
  -0.06863185, 0.04458595, -0.00516357, 0.00228111, 0.02601136, -0.05307885, 0.04075215, 0.00037651, -0.00924557,
  0.04160193, -0.03055851, 0.01277849, 0.0000068, 0.0340275, -0.01544172, 0.00316221, -0.00569185, 0.0207845,
  0.02643099, 0.02043694, -0.03147743, 0.04050598, 0.03667032, 0.00301181, 0.02560152, -0.00721392, -0.0009727,
  0.00163737, 0.02351824, -0.00602529, -0.01628637, -0.00279682, 0.04254608, -0.02454531, 0.00973255, 0.05536029,
  0.0127326, 0.00989514, 0.01029364, 0.00323119, -0.03687746, 0.00692138, 0.04021878, -0.00580412, 0.04886137,
  -0.00763243, -0.02928867, 0.01126446, -0.01280451, 0.03333422, -0.00605735, 0.0044366, 0.03983374, 0.02387487,
  0.01442343, 0.02602173, 0.0130047, -0.01783184, -0.00206966, -0.01938208, 0.01732914, 0.01224175, -0.0405199,
  -0.03542753, 0.01281625, -0.04376696, -0.01718682, -0.00980208, -0.04286815, -0.03636957, -0.00482342, 0.0021419,
  0.0191913, -0.01367328, 0.01899786, -0.01468559, 0.00363038, 0.01283451, 0.0108633, 0.00657239, 0.00545056,
  -0.00128527, 0.00990517, 0.01836394, 0.01849052, 0.01649776, 0.03327582, 0.00306578, 0.01578847, -0.01063592,
  0.01617989, 0.00718611, 0.01174998, 0.0070046, 0.0548162, -0.03660438, 0.05096142, -0.00139583, 0.01225012,
  0.00266356, -0.03360029, 0.05885835, 0.02758033, -0.0435594, 0.02186792, -0.01650203, -0.00270818, 0.00438335,
  0.00560111, 0.00824204, -0.00203019, 0.00294989, 0.02758028, 0.02987815, -0.01888488, 0.05577072, 0.01433602,
  0.00727538, 0.03509136, 0.00072143, -0.0347084, 0.00336468, 0.03621271, -0.02161429, -0.00248776, 0.05744356,
  0.06934106, 0.03886689, 0.02153531, -0.02139908, -0.02985409, -0.03175486, -0.03614256, -0.01555213,
];

/**
 * "Is this ONE known asset one the space can legitimately show right now?" - the correlated,
 * per-asset form of challenge eligibility, used only by `getEligibleRoundAsset`, which already
 * has the asset id and needs a single index probe per arm.
 *
 * The candidate queries express the SAME set the other way round: `spaceAssetIdUnion` drives from
 * the space's own membership rows plus the three visibility clauses below, because testing
 * membership per asset row made their cost proportional to the whole asset table rather than to
 * the space. Both forms must stay in step - what a round is generated FROM and what it is later
 * SERVED FROM cannot be allowed to drift apart. The `all four paths` guard in
 * game.repository.spec.ts pins both shapes.
 *
 * Two things it encodes:
 *
 *  - **All four of a space's asset paths.** A shared space's asset set is a four-arm union
 *    everywhere else in this fork - directly added assets, linked libraries, linked albums, and
 *    cross-owner album contributions - and `spaceAssetPathBranches` is the fork-owned helper
 *    that encodes them (its album arm ORs `album_asset` with `album_space_asset`). Selecting
 *    from `shared_space_asset` alone yields ZERO candidates for a space populated entirely
 *    through a linked album or a connected library, and reports the space as having no usable
 *    photos. Mirrors `SharedSpaceRepository.getAssetCount` / `getRecentAssets`.
 *  - **The design §5 visibility rules**: `deletedAt IS NULL`, `type = IMAGE`, and
 *    `visibility = 'timeline'`. Archived, hidden and locked assets are never eligible - which
 *    is also why the round-image route must re-run this rather than resolving the frozen
 *    `assetId` through the unscoped `AssetRepository.getById`.
 */
const eligibleSpaceAsset = (eb: ExpressionBuilder<DB, keyof DB>, spaceId: string): Expression<SqlBool> =>
  eb.and([
    eb.or(
      spaceAssetPathBranches(eb, {
        correlateAssetId: 'asset.id',
        correlateLibraryId: 'asset.libraryId',
        scope: { spaceId },
        requireShowInTimeline: true,
      }),
    ),
    eb('asset.deletedAt', 'is', null),
    eb('asset.type', '=', AssetType.Image),
    eb('asset.visibility', '=', AssetVisibility.Timeline),
  ]);

/**
 * A deterministic per-challenge shuffle of the candidate rows.
 *
 * `ORDER BY asset.id` is deterministic too, but it is *stably* deterministic: it pins every
 * challenge in a space to the same lowest-id prefix, so in a space with more assets than
 * `limit` no photo outside that prefix could ever appear in any challenge - falsifying design
 * §5's "adding photos to the space makes the game better". Hashing the id with the challenge's
 * own seed keeps reproducibility for a given `(spaceId, challengeCount)` while letting
 * successive challenges reach the whole space.
 *
 * Never `random()`: Postgres re-evaluates it per query, so the same seed could draw from a
 * different candidate SET on every call and the service's seeded sampling would mean nothing.
 *
 * Takes the column reference rather than hardcoding one: `getLocationCandidates` hashes
 * `"asset"."id"` in stage 1's sample CTE and `"sample"."assetId"` in stage 2's tiebreak, and both
 * have to hash the SAME underlying id the same way for the no-`scenePrompts` path to be exactly
 * the pre-two-stage query - a second hand-rolled copy of this expression is how the two could
 * silently drift apart.
 */
const seededOrder = (seed: string, ref: 'asset.id' | 'sample.assetId') => sql`md5(${sql.ref(ref)}::text || ${seed})`;

@Injectable()
export class GameRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  /**
   * Stage 2 of the location pool, shared by every scope: rank a stage-1 sample and return the
   * best `limit` rows. Two gates, and they are complementary - measurement against the 54 spike
   * images showed each catches what the other misses:
   *
   *   - face area <= 5% of the frame, so portraits (where the place is background behind a
   *     face) are excluded. Verified against a real Postgres that the ratio below is true
   *     floating-point division, not integer division truncating every sub-100% ratio to 0 -
   *     see the inline comment on the SQL expression;
   *   - ranked (never thresholded - see below) by CLIP similarity to "an outdoor photo that
   *     shows where it was taken" minus similarity to "a close-up of a person or an indoor
   *     room", because a face-free indoor kitchen passes the face gate and carries no location
   *     signal, and a single positive prompt alone under-ranks some known-good outdoor photos
   *     (measured: ranks 29 and 35 of 54 on positive-only; all six known-good photos moved into
   *     the top 20 once the negative prompt was subtracted).
   *
   * `smart_search.embedding <=> x` is cosine DISTANCE (1 - cosine similarity), so
   * `cos_sim_pos - cos_sim_neg` reduces to `(embedding <=> neg) - (embedding <=> pos)`; higher
   * is better, hence ORDER BY ... DESC. This two-term expression cannot use the ivfflat/vchord
   * index, so scoring every eligible row would be a full sequential scan over the vector column -
   * 30,212 rows and 133 MB of TOAST reads on the reference library (measured: 482ms warm,
   * 17-19s cold). That is why the pool runs as two stages instead of one query: stage 1 (the
   * caller's `sample` CTE) picks LOCATION_SAMPLE_SIZE rows using only narrow, indexable columns -
   * no smart_search, no asset_face - ordered by the same seeded hash as the final tiebreak; stage
   * 2 joins the vector column and the face gate onto just that sample and does the CLIP ranking
   * here. The expensive work is bounded by the sample size, not the library size.
   *
   * Ranked, never thresholded: the measured cosine margin between positive and negative prompts
   * is thin, so an absolute cutoff would pass everything in one library and nothing in another.
   * The rank this produces is only worth anything because `selectLocationRounds` draws from the
   * front of it (see RANK_BIAS_EXPONENT) - a uniform draw downstream makes the whole gate inert.
   *
   * `scenePrompts` undefined = the configured CLIP model is not one we have prompt vectors for,
   * so the ordering is dropped and the pool falls back to the seeded shuffle alone. The face
   * gate still applies.
   *
   * Shared between the scopes rather than copied per scope: the face gate and the CLIP ordering
   * are the two pieces of this file that have each already been broken once (integer division, an
   * unscoped aggregate), and a second copy is a second place for that to happen - one the
   * existing shape guards do not look at.
   */
  private async rankLocationSample(
    // Typed as an Expression of the row, not as a SelectQueryBuilder: each scope's stage 1 joins a
    // different set of tables, and a builder type is invariant in that set, so the space and solo
    // samples have no common builder type to name.
    sample: (db: QueryCreator<DB>) => Expression<GameCandidate>,
    limit: number,
    seed: string,
    scenePrompts?: ScenePromptEmbeddings,
  ): Promise<GameCandidate[]> {
    const rows = await this.db
      .with('sample', sample)
      // Stage 2: rank just the sample. The vector join and the face gate only ever touch these
      // LOCATION_SAMPLE_SIZE rows, not the whole eligible set.
      .selectFrom('sample')
      .leftJoin('smart_search', 'smart_search.assetId', 'sample.assetId')
      // Correlated, not an uncorrelated LEFT JOIN to a grouped subquery: the latter aggregates
      // every visible face row in the database before joining, which is 58k rows on the
      // reference library to gate a few thousand candidates.
      //
      // Equivalent to the old `ratio IS NULL OR ratio <= 0.05` in all three cases, and the
      // equivalence was verified against a real 56,730-row library (symmetric difference 0):
      //   - no faces        -> no group -> NOT EXISTS is true  -> kept
      //   - zero image area -> nullif gives NULL, `NULL > 0.05` is NULL, HAVING drops the group
      //                        -> NOT EXISTS is true           -> kept
      //   - ratio > 0.05    -> group survives HAVING           -> excluded
      // The zero-image-area branch has no rows in any library measured, so it is covered by
      // game-face-gate.spec.ts rather than by production data.
      // NOTE the SHADOWED inner `eb` in the exists() callback. The outer builder is scoped to the
      // outer query, so using outer `eb.ref('f.…')` here would resolve against the wrong context.
      // The callback form is the codebase pattern - see database.ts:893 and
      // asset.repository.ts:386.
      .where((eb) =>
        eb.not(
          eb.exists((eb) =>
            eb
              .selectFrom('asset_face as f')
              .select(sql`1`.as('one'))
              .whereRef('f.assetId', '=', 'sample.assetId')
              .where('f.deletedAt', 'is', null)
              .where('f.isVisible', '=', true)
              .groupBy('f.assetId')
              .having(
                sql<number>`sum(("f"."boundingBoxX2" - "f"."boundingBoxX1") * ("f"."boundingBoxY2" - "f"."boundingBoxY1"))::double precision / nullif(max("f"."imageWidth")::double precision * max("f"."imageHeight"), 0)`,
                '>',
                MAX_FACE_AREA_RATIO,
              ),
          ),
        ),
      )
      .selectAll('sample')
      .$if(!!scenePrompts, (qb) =>
        qb.orderBy(
          sql<number>`(smart_search.embedding <=> ${asVector(scenePrompts!.notPlace)}) - (smart_search.embedding <=> ${asVector(scenePrompts!.place)})`,
          (ob) => ob.desc().nullsLast(),
        ),
      )
      // Stable tiebreak: rows with no smart_search embedding (or an identical score) would
      // otherwise share a rank Postgres is free to order arbitrarily between calls. The caller's
      // generation seed only controls which of these candidates get picked, not the SQL order
      // they arrive in - an unstable tie order would silently defeat that determinism. Seeded
      // rather than `asset.id asc` so the tie group (and the whole pool, when the CLIP ordering
      // above is skipped) is not frozen to the same lowest-id prefix for every challenge. Through
      // seededOrder (not a second hand-rolled hash) so this can never drift from stage 1's - their
      // being identical is what makes the no-scenePrompts path exactly the pre-two-stage query.
      .orderBy(seededOrder(seed, 'sample.assetId'))
      .limit(limit)
      .execute();

    return rows;
  }

  /**
   * Location-round candidates for a space: stage 1 only. The face gate, the CLIP ranking and the
   * reason this is two stages at all are documented on `rankLocationSample` above.
   */
  @GenerateSql({
    params: [
      DummyValue.UUID,
      DummyValue.NUMBER,
      DummyValue.STRING,
      { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING },
    ],
  })
  async getLocationCandidates(
    spaceId: string,
    limit: number,
    seed: string,
    scenePrompts?: ScenePromptEmbeddings,
  ): Promise<GameCandidate[]> {
    return this.rankLocationSample(
      // Stage 1: a cheap seeded sample of eligible rows, narrow columns only - no smart_search,
      // no asset_face. This is what keeps the expensive stage-2 work bounded by
      // LOCATION_SAMPLE_SIZE instead of the whole eligible library.
      (db) =>
        db
          .selectFrom('asset')
          .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          // Lives in stage 1, not stage 2: the eligibility scope (and the GPS presence check
          // below) is what the sample is drawn FROM, so it has to apply before the LIMIT, not
          // after.
          //
          // The face gate deliberately does NOT live here - it runs in stage 2, against the
          // sample only (see the NOT EXISTS block there for why). That means CANDIDATE_POOL_LIMIT
          // (200, in game.service.ts) is the top of the GATED SUBSET of this LOCATION_SAMPLE_SIZE
          // (4,000-row) sample, not of the full eligible set: in a space with more than 4,000 GPS
          // photos and a low gate pass rate, this can return fewer than 200 candidates where the
          // old exhaustive form always filled the pool.
          //
          // Driven FROM the space's membership rows, not tested per asset row: the correlated
          // `eligibleSpaceAsset` form made this scan the whole asset table for every space,
          // however small the space. The union is built off `this.db` (like the four-way union
          // at access.repository.ts:284) and handed in as a prebuilt subquery - the CTE
          // callback's QueryCreator and the join's ExpressionBuilder are different types and
          // will not accept a `Kysely`-rooted `.union()`.
          .innerJoin(spaceAssetIdUnion(this.db, { spaceId }).as('space_asset'), (join) =>
            join.onRef('space_asset.assetId', '=', 'asset.id'),
          )
          .where('asset.deletedAt', 'is', null)
          .where('asset.type', '=', AssetType.Image)
          // The visibility floor stays here, ANDed outside the space union. None of the space
          // helpers exclude archived on their own - the shared-space visibility set admits it.
          .where('asset.visibility', '=', AssetVisibility.Timeline)
          .where('asset_exif.latitude', 'is not', null)
          .where('asset_exif.longitude', 'is not', null)
          .select([
            'asset.id as assetId',
            'asset_exif.latitude as lat',
            'asset_exif.longitude as lon',
            'asset.localDateTime as takenAt',
            'asset_exif.country as country',
          ])
          .orderBy(seededOrder(seed, 'asset.id'))
          .limit(LOCATION_SAMPLE_SIZE),
      limit,
      seed,
      scenePrompts,
    );
  }

  /** Date-round candidates for a space. No face/place gate - any timeline photo with a taken
   * date can carry a "when was this" question, so this is deliberately the simpler of the two
   * pools. Ordered by a seeded hash of the asset id (see seededOrder), not `random()` and no
   * longer by `asset.id`: the service layer seeds its own mulberry32-driven shuffle over
   * whatever this query returns, so a per-query `random()` would make that seed meaningless,
   * while a plain id order froze every challenge in the space to the same lowest-id 200 rows.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER, DummyValue.STRING] })
  async getDateCandidates(spaceId: string, limit: number, seed: string): Promise<GameCandidate[]> {
    const rows = await this.db
      .selectFrom('asset')
      // Driven FROM the space's membership rows for the same reason as getLocationCandidates'
      // stage 1 - see the comment there.
      .innerJoin(spaceAssetIdUnion(this.db, { spaceId }).as('space_asset'), (join) =>
        join.onRef('space_asset.assetId', '=', 'asset.id'),
      )
      .where('asset.deletedAt', 'is', null)
      .where('asset.type', '=', AssetType.Image)
      // The visibility floor stays here, ANDed outside the space union. None of the space
      // helpers exclude archived on their own - the shared-space visibility set admits it.
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.localDateTime', 'is not', null)
      .select(['asset.id as assetId', 'asset.localDateTime as takenAt'])
      .orderBy(seededOrder(seed, 'asset.id'))
      .limit(limit)
      .execute();

    return rows.map((row) => ({ assetId: row.assetId, lat: null, lon: null, takenAt: row.takenAt, country: null }));
  }

  /**
   * The preview file of a round's asset, resolved through `eligibleSpaceAsset` - the correlated
   * per-asset form of the same eligibility the candidate queries express as a space-driven union
   * (equivalent, not literally the same query; see the two-forms note above `eligibleSpaceAsset`,
   * ~line 186) - not `AssetRepository.getById`, which applies no `deletedAt`, no visibility and no
   * space predicate at all.
   *
   * Rounds are frozen by design (§4.1), so a round's `assetId` is permanent; without this the
   * round-image route honoured that forever and kept serving a photo the owner had since
   * removed from the space, trashed (for the whole 30-day soft-delete window), or moved into
   * the locked folder - to every member, including ones who joined afterwards. Design §5:
   * "the game never shows anyone a photo they could not already open in Gallery."
   *
   * Returning nothing is the correct outcome, not an error: the round stays scoreable from its
   * denormalised answer (§9), only the image is gone.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getEligibleRoundAsset(spaceId: string, assetId: string): Promise<{ previewPath: string } | undefined> {
    return (
      this.db
        .selectFrom('asset')
        .innerJoin('asset_file', (join) =>
          join.onRef('asset_file.assetId', '=', 'asset.id').on('asset_file.type', '=', AssetFileType.Preview),
        )
        .select('asset_file.path as previewPath')
        .where('asset.id', '=', asUuid(assetId))
        .where((eb) => eligibleSpaceAsset(eb, spaceId))
        // An edited asset carries a second preview row; prefer the unedited one, matching
        // AssetRepository.getForThumbnail's default (`isEdited: false`) for the same file type.
        .orderBy('asset_file.isEdited', 'asc')
        .limit(1)
        .executeTakeFirst()
    );
  }

  /**
   * Asset ids used by rounds of the space's `challengeLimit` most recently created challenges -
   * so a new challenge can avoid repeating a photo the same group just played.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async getRecentlyUsedAssetIds(spaceId: string, challengeLimit: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('game_round')
      .where(
        'game_round.challengeId',
        'in',
        this.db
          .selectFrom('game_challenge')
          .select('game_challenge.id')
          .where('game_challenge.spaceId', '=', spaceId)
          .orderBy('game_challenge.createdAt', 'desc')
          .limit(challengeLimit),
      )
      .where('game_round.assetId', 'is not', null)
      .select('game_round.assetId as assetId')
      .distinct()
      .$narrowType<{ assetId: string }>()
      .execute();

    return rows.map((row) => row.assetId);
  }

  // ── the solo pool ─────────────────────────────────────────────────────────────────────────
  //
  // The same questions as the space pool, asked of one player's own scope. The three that read
  // photos are each generated FOUR times - see the names on the decorators - because their read
  // arms are conditional on the player's frozen source toggles, and one variant could not pin the
  // toggles at all.
  //
  // The two asymmetric variants are the load-bearing ones. With only (false,false) and (true,true)
  // generated, an arm gated on the WRONG flag - the space arm reading withPartners, or a union that
  // tests the wrong field - emits nothing under the first and everything under the second, exactly
  // like correct code, while a player who enabled only partners silently receives shared-space
  // photos. Only a variant where the two flags DIFFER can tell those apart.
  //
  // Both asymmetric directions are generated, not just one: `partners only` catches a SPACE arm
  // gated on withPartners, but a PARTNER arm cross-wired to withSpaces is invisible to it (that arm
  // is legitimately absent there) and equally invisible to both symmetric variants - so it passed
  // every guard until `spaces only` existed. The failure it hides is the same shape and the same
  // severity: photos from someone the player never opted into.

  /**
   * Location-round candidates for a solo player: stage 1 only, ranked by the shared
   * `rankLocationSample` above.
   *
   * Stage 1's driver is the only thing that differs from the space pool: `soloPoolAssetIdUnion`
   * in place of `spaceAssetIdUnion`. See there for the measurements behind it being a union in
   * every source combination, including the default one.
   */
  @GenerateSql(
    {
      name: 'own library only',
      params: [
        { userId: DummyValue.UUID, withPartners: false, withSpaces: false },
        DummyValue.NUMBER,
        DummyValue.STRING,
        { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING },
      ],
    },
    {
      name: 'partners only',
      params: [
        { userId: DummyValue.UUID, withPartners: true, withSpaces: false },
        DummyValue.NUMBER,
        DummyValue.STRING,
        { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING },
      ],
    },
    {
      name: 'spaces only',
      params: [
        { userId: DummyValue.UUID, withPartners: false, withSpaces: true },
        DummyValue.NUMBER,
        DummyValue.STRING,
        { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING },
      ],
    },
    {
      name: 'all sources',
      params: [
        { userId: DummyValue.UUID, withPartners: true, withSpaces: true },
        DummyValue.NUMBER,
        DummyValue.STRING,
        { place: PLACE_PROMPT_EMBEDDING, notPlace: NOT_PLACE_PROMPT_EMBEDDING },
      ],
    },
  )
  async getSoloLocationCandidates(
    sources: SoloPoolSources,
    limit: number,
    seed: string,
    scenePrompts?: ScenePromptEmbeddings,
  ): Promise<GameCandidate[]> {
    const poolIds = soloPoolAssetIdUnion(this.db, sources);

    return this.rankLocationSample(
      (db) =>
        db
          .selectFrom('asset')
          .innerJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
          // Driven FROM the enabled id sources for the same reason the space pool drives from its
          // own union - measured, see soloPoolAssetIdUnion. One shape for every source combination,
          // so there is no branch here that can be restructured into scoping nothing at all.
          .innerJoin(poolIds.as('pool_asset'), (join) => join.onRef('pool_asset.assetId', '=', 'asset.id'))
          .where('asset.deletedAt', 'is', null)
          .where('asset.type', '=', AssetType.Image)
          // The floor stays here, ANDed outside the id-source union. Those sources answer only
          // "can this player reach the asset" - archived, hidden and locked photos are reachable
          // through them, and this is the one clause that keeps all three out of the pool.
          .where('asset.visibility', '=', AssetVisibility.Timeline)
          .where('asset_exif.latitude', 'is not', null)
          .where('asset_exif.longitude', 'is not', null)
          .select([
            'asset.id as assetId',
            'asset_exif.latitude as lat',
            'asset_exif.longitude as lon',
            'asset.localDateTime as takenAt',
            'asset_exif.country as country',
          ])
          .orderBy(seededOrder(seed, 'asset.id'))
          .limit(LOCATION_SAMPLE_SIZE),
      limit,
      seed,
      scenePrompts,
    );
  }

  /** Date-round candidates for a solo player. The space pool's simpler twin, driven the same way
   * `getSoloLocationCandidates`' stage 1 is - see the note there on why the driver is conditional.
   */
  @GenerateSql(
    {
      name: 'own library only',
      params: [
        { userId: DummyValue.UUID, withPartners: false, withSpaces: false },
        DummyValue.NUMBER,
        DummyValue.STRING,
      ],
    },
    {
      name: 'partners only',
      params: [
        { userId: DummyValue.UUID, withPartners: true, withSpaces: false },
        DummyValue.NUMBER,
        DummyValue.STRING,
      ],
    },
    {
      name: 'spaces only',
      params: [
        { userId: DummyValue.UUID, withPartners: false, withSpaces: true },
        DummyValue.NUMBER,
        DummyValue.STRING,
      ],
    },
    {
      name: 'all sources',
      params: [{ userId: DummyValue.UUID, withPartners: true, withSpaces: true }, DummyValue.NUMBER, DummyValue.STRING],
    },
  )
  async getSoloDateCandidates(sources: SoloPoolSources, limit: number, seed: string): Promise<GameCandidate[]> {
    const poolIds = soloPoolAssetIdUnion(this.db, sources);

    const rows = await this.db
      .selectFrom('asset')
      // Driven FROM the enabled id sources - see getSoloLocationCandidates' stage 1.
      .innerJoin(poolIds.as('pool_asset'), (join) => join.onRef('pool_asset.assetId', '=', 'asset.id'))
      .where('asset.deletedAt', 'is', null)
      .where('asset.type', '=', AssetType.Image)
      // The floor stays here, ANDed outside the id-source union - see getSoloLocationCandidates.
      .where('asset.visibility', '=', AssetVisibility.Timeline)
      .where('asset.localDateTime', 'is not', null)
      .select(['asset.id as assetId', 'asset.localDateTime as takenAt'])
      .orderBy(seededOrder(seed, 'asset.id'))
      .limit(limit)
      .execute();

    return rows.map((row) => ({ assetId: row.assetId, lat: null, lon: null, takenAt: row.takenAt, country: null }));
  }

  /**
   * The preview file of a solo round's asset, resolved through `eligibleSoloAsset` - the
   * correlated per-asset form of the same eligibility the two candidate queries above express as
   * an id-source union - and never through `AssetRepository.getById`, which applies no
   * `deletedAt`, no visibility and no scope predicate at all.
   *
   * The `sources` handed in are the ones FROZEN on the challenge row, not the player's live
   * preference: a round drawn from a partner's library when the toggle was on stays servable
   * after the player turns it off, and a round can never become servable because they turned one
   * on. Access itself is still live - unpartnering, or leaving the space, stops the image at the
   * next request, which is the same contract the space game has for a photo removed from a space.
   *
   * Returning nothing is the correct outcome, not an error: the round stays scoreable from its
   * denormalised answer (§9), only the image is gone.
   */
  @GenerateSql(
    {
      name: 'own library only',
      params: [{ userId: DummyValue.UUID, withPartners: false, withSpaces: false }, DummyValue.UUID],
    },
    {
      name: 'partners only',
      params: [{ userId: DummyValue.UUID, withPartners: true, withSpaces: false }, DummyValue.UUID],
    },
    {
      name: 'spaces only',
      params: [{ userId: DummyValue.UUID, withPartners: false, withSpaces: true }, DummyValue.UUID],
    },
    {
      name: 'all sources',
      params: [{ userId: DummyValue.UUID, withPartners: true, withSpaces: true }, DummyValue.UUID],
    },
  )
  async getSoloEligibleRoundAsset(
    sources: SoloPoolSources,
    assetId: string,
  ): Promise<{ previewPath: string } | undefined> {
    return (
      this.db
        .selectFrom('asset')
        .innerJoin('asset_file', (join) =>
          join.onRef('asset_file.assetId', '=', 'asset.id').on('asset_file.type', '=', AssetFileType.Preview),
        )
        .select('asset_file.path as previewPath')
        .where('asset.id', '=', asUuid(assetId))
        .where((eb) => eligibleSoloAsset(eb, sources))
        // An edited asset carries a second preview row; prefer the unedited one, matching
        // AssetRepository.getForThumbnail's default (`isEdited: false`) for the same file type.
        .orderBy('asset_file.isEdited', 'asc')
        .limit(1)
        .executeTakeFirst()
    );
  }

  /**
   * Asset ids used by rounds of the player's `challengeLimit` most recently created solo
   * challenges - so a new one can avoid repeating a photo they just played. Scoped by owner
   * rather than by space; otherwise identical to `getRecentlyUsedAssetIds`.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async getSoloRecentlyUsedAssetIds(ownerId: string, challengeLimit: number): Promise<string[]> {
    const rows = await this.db
      .selectFrom('game_round')
      .where(
        'game_round.challengeId',
        'in',
        this.db
          .selectFrom('game_challenge')
          .select('game_challenge.id')
          .where('game_challenge.ownerId', '=', ownerId)
          .orderBy('game_challenge.createdAt', 'desc')
          .limit(challengeLimit),
      )
      .where('game_round.assetId', 'is not', null)
      .select('game_round.assetId as assetId')
      .distinct()
      .$narrowType<{ assetId: string }>()
      .execute();

    return rows.map((row) => row.assetId);
  }

  /**
   * How many player-created solo challenges this user already has. A count rather than the rows,
   * because the only caller wants the number - and it feeds the generation seed
   * (`user:<id>:<count>`), which is why dailies are excluded here for exactly the reason
   * `getChallengesForSpace` excludes them: letting a daily bump the count would change which
   * photos every future custom challenge draws, once a day, for reasons the player never sees.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSoloChallengeCount(ownerId: string): Promise<number> {
    const row = await this.db
      .selectFrom('game_challenge')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('game_challenge.ownerId', '=', ownerId)
      .where('game_challenge.dailyOn', 'is', null)
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  /**
   * Inserts a challenge and its rounds atomically. `rounds[].challengeId` is stamped with the
   * newly created challenge's id here rather than trusted from the caller - the caller cannot
   * know the id before this insert runs.
   */
  @GenerateSql({
    params: [
      {
        spaceId: DummyValue.UUID,
        createdById: DummyValue.UUID,
        name: DummyValue.STRING,
        roundCount: 5,
        scaleKm: 1000,
        scaleDays: 365,
      },
      [
        {
          challengeId: DummyValue.UUID,
          index: 0,
          type: 'location',
          assetId: DummyValue.UUID,
          answerLat: 0,
          answerLon: 0,
          answerDate: null,
        },
      ],
    ],
  })
  async createChallenge(
    challenge: Insertable<GameChallengeTable>,
    rounds: Insertable<GameRoundTable>[],
  ): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('game_challenge')
        .values(challenge)
        .returning('id')
        .executeTakeFirstOrThrow();

      if (rounds.length > 0) {
        await trx
          .insertInto('game_round')
          .values(rounds.map((round) => ({ ...round, challengeId: inserted.id })))
          .execute();
      }

      return inserted.id;
    });
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getChallenge(id: string): Promise<GameChallengeRow | undefined> {
    return this.db.selectFrom('game_challenge').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /**
   * A space's player-created challenges, newest first. Dailies are excluded in the QUERY rather
   * than filtered by the caller: they accumulate one per day forever, so a service-side filter
   * would load an unbounded and growing set only to discard it.
   *
   * This also feeds the generation seed (`spaceId:challengeCount`), which is why the count has to
   * stay player-created-only - letting dailies bump it would change which photos every future
   * custom challenge draws, once a day, for reasons the player never sees.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getChallengesForSpace(spaceId: string): Promise<GameChallengeRow[]> {
    return this.db
      .selectFrom('game_challenge')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('dailyOn', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  // dailyOn is a YYYY-MM-DD string, not a Date - DummyValue.DATE would hand this a timestamp.
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getDailyChallenge(spaceId: string, dailyOn: string): Promise<GameChallengeRow | undefined> {
    return (
      this.db
        .selectFrom('game_challenge')
        .selectAll()
        .where('spaceId', '=', spaceId)
        // Cast explicitly: the column reads back as a Date (the `date` convention this codebase uses
        // for person.birthDate too), while the caller holds the UTC calendar day as a string.
        .where('dailyOn', '=', sql<Date>`${dailyOn}::date`)
        .executeTakeFirst()
    );
  }

  /**
   * One player's own daily for a UTC calendar day.
   *
   * A second method rather than a nullable-scope parameter on `getDailyChallenge`: the two scopes
   * are enforced by two different partial unique indexes (Postgres treats NULLs as distinct, so
   * the space index does not constrain solo rows at all), and a single query taking both ids
   * would be one `where` away from reading across scopes.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING] })
  async getSoloDailyChallenge(ownerId: string, dailyOn: string): Promise<GameChallengeRow | undefined> {
    return (
      this.db
        .selectFrom('game_challenge')
        .selectAll()
        .where('ownerId', '=', ownerId)
        // Cast explicitly, for the same reason getDailyChallenge does: the column reads back as a
        // Date while the caller holds the UTC calendar day as a string.
        .where('dailyOn', '=', sql<Date>`${dailyOn}::date`)
        .executeTakeFirst()
    );
  }

  /**
   * How many location rounds each of a space's challenges has, as one aggregate rather than a
   * per-challenge round fetch - the list endpoint only needs the count, and loading whole rounds
   * would pull every answer coordinate into the service to throw away.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getLocationRoundCounts(spaceId: string): Promise<{ challengeId: string; locationCount: number }[]> {
    const rows = await this.db
      .selectFrom('game_round')
      .innerJoin('game_challenge', 'game_challenge.id', 'game_round.challengeId')
      .where('game_challenge.spaceId', '=', spaceId)
      .where('game_round.type', '=', 'location')
      .groupBy('game_round.challengeId')
      .select((eb) => ['game_round.challengeId', eb.fn.countAll<string>().as('locationCount')])
      .execute();

    return rows.map((row) => ({ challengeId: row.challengeId, locationCount: Number(row.locationCount) }));
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getRounds(challengeId: string): Promise<GameRoundRow[]> {
    return this.db
      .selectFrom('game_round')
      .selectAll()
      .where('challengeId', '=', challengeId)
      .orderBy('index', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async getRound(challengeId: string, index: number): Promise<GameRoundRow | undefined> {
    return this.db
      .selectFrom('game_round')
      .selectAll()
      .where('challengeId', '=', challengeId)
      .where('index', '=', index)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getGuessesForUser(challengeId: string, userId: string): Promise<GameGuessRow[]> {
    return this.db
      .selectFrom('game_guess')
      .innerJoin('game_round', 'game_round.id', 'game_guess.roundId')
      .where('game_round.challengeId', '=', challengeId)
      .where('game_guess.userId', '=', userId)
      .selectAll('game_guess')
      .execute();
  }

  // Uniqueness (one guess per round per user) is enforced by the game_guess_round_user_uq
  // constraint, not here - a duplicate submit surfaces as a Postgres unique-violation error
  // (with `.constraint === 'game_guess_round_user_uq'`) that the caller maps to a 409.
  @GenerateSql({
    params: [
      {
        roundId: DummyValue.UUID,
        userId: DummyValue.UUID,
        guessLat: 0,
        guessLon: 0,
        guessDate: null,
        distanceKm: 0,
        offsetDays: null,
        score: 5000,
      },
    ],
  })
  async createGuess(guess: Insertable<GameGuessTable>): Promise<GameGuessRow> {
    return this.db.insertInto('game_guess').values(guess).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async getLeaderboard(challengeId: string): Promise<{ userId: string; total: number; answered: number }[]> {
    const rows = await this.db
      .selectFrom('game_guess')
      .innerJoin('game_round', 'game_round.id', 'game_guess.roundId')
      .where('game_round.challengeId', '=', challengeId)
      .groupBy('game_guess.userId')
      .select('game_guess.userId as userId')
      .select((eb) => eb.fn.sum<string>('game_guess.score').as('total'))
      .select((eb) => eb.fn.count<string>('game_guess.id').as('answered'))
      .orderBy('total', 'desc')
      .execute();

    return rows.map((row) => ({ userId: row.userId, total: Number(row.total), answered: Number(row.answered) }));
  }

  /**
   * Per-player totals across a space's DAILY challenges within one month.
   *
   * The bounds are half-open - `[monthStart, monthEndExclusive)` - so no daily can be claimed by
   * two months and no `23:59:59` boundary has to be written down anywhere. Both are `YYYY-MM-DD`
   * and are cast to `date` for the same reason `getDailyChallenge` does it: the column reads back
   * as a Date while the caller holds a UTC calendar day as a string.
   *
   * `dailyOn IS NOT NULL` is what excludes player-created challenges. It is redundant against the
   * range comparisons (a NULL fails both) and kept anyway, because it is the line that states the
   * rule - a later edit that loosens the range must not silently start counting custom challenges.
   *
   * Deliberately unordered: ties are broken by player NAME, which lives in the member list this
   * repository knows nothing about. GameService sorts.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async getMonthlyStandings(
    spaceId: string,
    monthStart: string,
    monthEndExclusive: string,
  ): Promise<{ userId: string; total: number; daysPlayed: number }[]> {
    const rows = await this.db
      .selectFrom('game_guess')
      .innerJoin('game_round', 'game_round.id', 'game_guess.roundId')
      .innerJoin('game_challenge', 'game_challenge.id', 'game_round.challengeId')
      .where('game_challenge.spaceId', '=', spaceId)
      .where('game_challenge.dailyOn', 'is not', null)
      .where('game_challenge.dailyOn', '>=', sql<Date>`${monthStart}::date`)
      .where('game_challenge.dailyOn', '<', sql<Date>`${monthEndExclusive}::date`)
      .groupBy('game_guess.userId')
      .select('game_guess.userId as userId')
      .select((eb) => eb.fn.sum<string>('game_guess.score').as('total'))
      .select((eb) => eb.fn.count<string>('game_round.challengeId').distinct().as('daysPlayed'))
      .execute();

    return rows.map((row) => ({
      userId: row.userId,
      total: Number(row.total),
      daysPlayed: Number(row.daysPlayed),
    }));
  }

  /**
   * The UTC calendar days this player FINISHED their own daily on - every round guessed.
   *
   * The `having` is the whole point, and it is why this is not a `distinct dailyOn` over played
   * dailies: a partially played daily scores, and appears in history, but does not extend the
   * streak. Expressing that here rather than in the caller is deliberate - the rule is a property
   * of "which days count", and a client-side version of it would be one refactor away from
   * counting a single guess as a day.
   *
   * One row per completed daily is one row per DAY without a `distinct`: a second daily for the
   * same owner and date cannot exist, `game_challenge_owner_daily_uq` forbids it. `computeStreak`
   * deduplicates anyway, so the two of them do not have to agree about that.
   *
   * The days come back as `YYYY-MM-DD` strings straight from Postgres rather than as Dates: the
   * driver turns a `date` column into UTC midnight and `asDateString` formats it in the SERVER's
   * zone, so on any instance west of UTC every day would be renamed to the one before it - and the
   * streak compares these against a UTC "today".
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSoloCompletedDailyDates(ownerId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('game_challenge')
      .innerJoin('game_round', 'game_round.challengeId', 'game_challenge.id')
      // A solo challenge has exactly one player - its owner - so this is the same set of rows the
      // owner filter below already implies, and it says so rather than trusting the gate.
      .innerJoin('game_guess', (join) =>
        join.onRef('game_guess.roundId', '=', 'game_round.id').on('game_guess.userId', '=', ownerId),
      )
      .where('game_challenge.ownerId', '=', ownerId)
      .where('game_challenge.dailyOn', 'is not', null)
      .groupBy('game_challenge.id')
      .having((eb) => eb(eb.fn.count('game_guess.id'), '=', eb.ref('game_challenge.roundCount')))
      .select(sql<string>`to_char(${sql.ref('game_challenge.dailyOn')}, 'YYYY-MM-DD')`.as('dailyOn'))
      .execute();

    return rows.map((row) => row.dailyOn);
  }

  /**
   * One player's score record across their solo games - dailies and free play alike.
   *
   * Aggregated over per-game totals (the inner group-by), not over raw guesses: "best score" means
   * the best GAME, and a max over individual guesses would report a single lucky round instead.
   *
   * Zeroes rather than nulls for a player who has never played, so the stats panel has nothing to
   * special-case - `max`/`avg` of no rows are NULL, and that NULL is coalesced here rather than
   * being left for each caller to remember.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSoloScoreSummary(
    ownerId: string,
  ): Promise<{ gamesPlayed: number; bestScore: number; averageScore: number }> {
    const row = await this.db
      .selectFrom((eb) =>
        eb
          .selectFrom('game_challenge')
          .innerJoin('game_round', 'game_round.challengeId', 'game_challenge.id')
          .innerJoin('game_guess', (join) =>
            join.onRef('game_guess.roundId', '=', 'game_round.id').on('game_guess.userId', '=', ownerId),
          )
          .where('game_challenge.ownerId', '=', ownerId)
          .groupBy('game_challenge.id')
          .select((inner) => inner.fn.sum<string>('game_guess.score').as('total'))
          .as('game_totals'),
      )
      // The inner join above already excludes games with no guesses, so this counts games PLAYED -
      // the same set history lists, and the set the average has to divide by.
      .select((eb) => eb.fn.countAll<string>().as('gamesPlayed'))
      .select((eb) => eb.fn.max<string | null>('game_totals.total').as('bestScore'))
      .select((eb) => eb.fn.avg<string | null>('game_totals.total').as('averageScore'))
      .executeTakeFirstOrThrow();

    return {
      gamesPlayed: Number(row.gamesPlayed),
      bestScore: Number(row.bestScore ?? 0),
      averageScore: Number(row.averageScore ?? 0),
    };
  }

  /**
   * One page of the player's own games, newest first, each with what they scored on it.
   *
   * Games they actually PLAYED: the inner join to their guesses is what excludes a challenge that
   * was generated and never touched - one the nightly prune deletes anyway, and which the player
   * has no memory of to browse. A partially played one is a real game with a real score and stays.
   *
   * Ordered by `createdAt` with the id as the tie-break, so a page boundary cannot show or skip a
   * game because two of them share a timestamp; challenge ids are uuidv7, hence time-ordered.
   */
  @GenerateSql({ params: [DummyValue.UUID, { skip: 0, take: 20 }] })
  async getSoloHistory(ownerId: string, { skip, take }: { skip: number; take: number }): Promise<GameSoloHistoryRow[]> {
    const rows = await this.db
      .selectFrom('game_challenge')
      .innerJoin('game_round', 'game_round.challengeId', 'game_challenge.id')
      .innerJoin('game_guess', (join) =>
        join.onRef('game_guess.roundId', '=', 'game_round.id').on('game_guess.userId', '=', ownerId),
      )
      .where('game_challenge.ownerId', '=', ownerId)
      .groupBy('game_challenge.id')
      .select(['game_challenge.id', 'game_challenge.name', 'game_challenge.roundCount', 'game_challenge.createdAt'])
      // As a string, for the same reason getSoloCompletedDailyDates does it: history and the streak
      // must name the same day, and a Date round-trip renames it on a server west of UTC.
      .select(sql<string | null>`to_char(${sql.ref('game_challenge.dailyOn')}, 'YYYY-MM-DD')`.as('dailyOn'))
      .select((eb) => eb.fn.count<string>('game_guess.id').as('answered'))
      .select((eb) => eb.fn.sum<string>('game_guess.score').as('total'))
      .orderBy('game_challenge.createdAt', 'desc')
      .orderBy('game_challenge.id', 'desc')
      .limit(take)
      .offset(skip)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      dailyOn: row.dailyOn,
      createdAt: row.createdAt,
      roundCount: row.roundCount,
      answered: Number(row.answered),
      total: Number(row.total),
    }));
  }

  // Rounds and guesses cascade-delete via their FKs (game_round.challengeId, game_guess.roundId
  // both ON DELETE CASCADE) - deleting the challenge row is enough.
  @GenerateSql({ params: [DummyValue.UUID] })
  async deleteChallenge(id: string): Promise<void> {
    await this.db.deleteFrom('game_challenge').where('id', '=', id).execute();
  }

  /**
   * Deletes challenges nobody ever played: created before `olderThan`, with zero `game_guess`
   * rows across every one of their rounds. No scope filter at all - a space daily nobody opened
   * is exactly as much dead weight as a solo one, and this query does not distinguish them.
   *
   * Deliberately "zero guesses", not "not finished": `game_round.challengeId not in (... inner
   * join game_guess ...)` excludes a challenge the moment ANY round has a guess, so a challenge
   * with even one answered round - a real score already on the leaderboard and in history (see
   * getSoloHistory / getSoloScoreSummary) - survives. Only a challenge with no `game_guess` row
   * anywhere among its rounds is a candidate at all. Rounds and guesses cascade-delete via their
   * FKs, same as deleteChallenge above.
   */
  @GenerateSql({ params: [DummyValue.DATE] })
  async deleteUnplayedChallenges(olderThan: Date): Promise<void> {
    await this.db
      .deleteFrom('game_challenge')
      .where('createdAt', '<', olderThan)
      .where(
        'id',
        'not in',
        this.db
          .selectFrom('game_round')
          .innerJoin('game_guess', 'game_guess.roundId', 'game_round.id')
          .select('game_round.challengeId'),
      )
      .execute();
  }
}
