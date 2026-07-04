import { describe, expect, it } from 'vitest';
import {
  parseResponse,
  parseStatisticResponse,
  parseVersionResponse,
  PixliteError,
  serializeIdentify,
  serializeModeTestData,
  serializeRequest,
  serializeStatisticRead,
} from './protocol';

// ── Fixture JSON captured verbatim from the API doc ──────────────────────────

// doc §7.15 Figure 35 — the special-case GET /ver response.
const VER_FIXTURE =
  '{"resp":"version","result":{"apiVer":[{"maj":"v1","min":[0,3]},{"maj":"newApi1","min":[1,2]}],"fwVer":"1.2.3","prodName":"PixLite A16-S Mk3","prodFamily":1349089331,"prodfamilyName":"PixLite Mk3","nickname":"Roof Left 1","oem":0,"fwCheckBit":0,"authReqd":false,"spaVer":"1.0.0"}}';

// doc §7.13 Figure 28 — the full statistic object, wrapped in a statisticRead response.
const STATISTIC_FIXTURE =
  '{"resp":"statisticRead","id":1,"result":{"statistic":{"net":{"ipAddr":"192.168.0.100","netmask":"255.255.225.0","gateway":"192.168.0.1"},"dev":{"bankVolt":[5000,5000],"temp":{"current":32.5,"min":19.8,"max":33.1},"cpu":0},"pixPwrOuts":{"current":[1000,1500,1200,1300],"fuseGood":[true,true,true,true]},"pixData":{"outFrmRate":45,"inFrmRate":45,"recFrmRate":45,"syncAddr":5,"forceSync":false,"extSync":true,"overrun":0,"overrunDrop":0,"liveIntFr":45,"liveIntAv":true},"auxData":{"outFrmRate":[0],"inFrmRate":[0]},"eth":{"extp":{"linkUp":[true,true],"linkSpeed":[1000,1000]}},"ethProt":{"inGoodOther":0,"inBadOther":0,"sACN":{"inGoodOther":0,"inBadOther":0,"inFilt":0},"artNet":{"inGoodOther":0,"inBadOther":0,"inFilt":0},"inUni":{"sACN":{"uniNum":[10,11,12],"timedOut":[false,false,false],"sourceName":["Your Lighting Software","Your Lighting Software","Your Lighting Software"],"inGood":[1000,1000,1000],"inBadSeq":[0,0,0],"inLowPri":[0,0,0],"priority":[100,100,100],"syncAddr":[200,200,200],"reqForceSync":[false,false,false]}}},"trig":{"fr":[45],"av":[true]},"diag":{"errCnt":0,"err":""}}}}';

describe('request serialization (strict member order)', () => {
  it('always emits req as the first member', () => {
    expect(serializeRequest('identify', 7).startsWith('{"req":"identify"')).toBe(true);
  });

  it('serializes identify exactly (doc §7.5)', () => {
    expect(serializeIdentify(1, 121)).toBe('{"req":"identify","id":1,"params":{"duration":121}}');
  });

  it('serializes statisticRead exactly (doc §7.13)', () => {
    expect(serializeStatisticRead(2, ['dev.temp.current'])).toBe(
      '{"req":"statisticRead","id":2,"params":{"path":["dev.temp.current"]}}',
    );
    expect(serializeStatisticRead(1, [''])).toBe(
      '{"req":"statisticRead","id":1,"params":{"path":[""]}}',
    );
  });

  it('serializes modeTestData members in doc order: op, color, colorRes, pixPortNum, pixNum', () => {
    expect(
      serializeModeTestData(1, {
        op: 'setColor',
        color: [255, 0, 0, 0],
        colorRes: '8Bit',
        pixPortNum: 0,
        pixNum: 0,
      }),
    ).toBe(
      '{"req":"modeTestData","id":1,"params":{"op":"setColor","color":[255,0,0,0],"colorRes":"8Bit","pixPortNum":0,"pixNum":0}}',
    );
    // Partial params omit absent members but keep order.
    expect(serializeModeTestData(3, { op: 'rgbwCycle' })).toBe(
      '{"req":"modeTestData","id":3,"params":{"op":"rgbwCycle"}}',
    );
  });
});

describe('parseVersionResponse', () => {
  it('extracts identity from the /ver fixture', () => {
    const id = parseVersionResponse(VER_FIXTURE, '192.168.1.50');
    expect(id).toEqual({
      host: '192.168.1.50',
      prodName: 'PixLite A16-S Mk3',
      nickname: 'Roof Left 1',
      fwVer: '1.2.3',
      apiVer: [
        { maj: 'v1', min: [0, 3] },
        { maj: 'newApi1', min: [1, 2] },
      ],
      authReqd: false,
    });
  });

  it('returns null for non-version JSON and for garbage', () => {
    expect(parseVersionResponse('{"resp":"statisticRead","result":{}}', 'h')).toBeNull();
    expect(parseVersionResponse('not json at all', 'h')).toBeNull();
    expect(parseVersionResponse('{"resp":"version"}', 'h')).toBeNull(); // no result.prodName
  });
});

describe('parseStatisticResponse', () => {
  it('zips per-universe arrays and pulls rates + health from the fixture', () => {
    const s = parseStatisticResponse(STATISTIC_FIXTURE);
    expect(s.universes.sACN).toHaveLength(3);
    expect(s.universes.sACN[0]).toEqual({
      uniNum: 10,
      timedOut: false, // false = receiving
      inGood: 1000,
      inBadSeq: 0,
      inLowPri: 0,
      priority: 100,
      sourceName: 'Your Lighting Software',
    });
    expect(s.universes.artNet).toEqual([]);
    expect(s.rates).toEqual({ inFrmRate: 45, outFrmRate: 45 });
    expect(s.health.tempC).toBe(32.5);
    expect(s.health.bankVoltsMv).toEqual([5000, 5000]);
    expect(s.health.ethLinkUp).toEqual([true, true]);
  });

  it('maps pixPwrOuts.stat into portStatus when present (v1.7 field)', () => {
    const body =
      '{"resp":"statisticRead","result":{"statistic":{"pixPwrOuts":{"stat":["Good","OvrCur","FuseBlwn","Good"]}}}}';
    expect(parseStatisticResponse(body).health.portStatus).toEqual([
      'Good',
      'OvrCur',
      'FuseBlwn',
      'Good',
    ]);
  });
});

describe('parseResponse error handling', () => {
  it('throws PixliteError when the controller returns an err object (doc Figure 4)', () => {
    const body = '{"resp":"configChange","id":1,"err":{"code":3,"msg":"The pix.freq field may not be > 3000."}}';
    expect(() => parseResponse(body)).toThrowError(PixliteError);
    try {
      parseResponse(body);
    } catch (e) {
      expect(e).toBeInstanceOf(PixliteError);
      expect((e as PixliteError).code).toBe(3);
    }
  });

  it('throws on non-JSON bodies', () => {
    expect(() => parseResponse('<html>500</html>')).toThrow();
  });
});
