// Aggregates every scenario category. Add a new file here to grow the battery.
import recall from './classification-recall.mjs';
import negatives from './classification-negatives.mjs';
import slots from './slot-fidelity.mjs';
import copy from './copy.mjs';

export default [...recall, ...negatives, ...slots, ...copy];
