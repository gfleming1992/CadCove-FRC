import buildLeftFront from '../front-corner.js';
export {baseProfile,upperProfile,identificationProfiles} from '../front-corner.js';
// Left-front stock, clearance and mounting bore share their dimensions with RF.
export const parameters={holeScale:1,engravingDepth:1.5875};
export default function build(options={}) { return buildLeftFront({...parameters,...options}); }
